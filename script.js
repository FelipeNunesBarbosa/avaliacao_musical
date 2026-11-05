import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = (selector) => document.querySelector(selector);
const reportInput = $('#report-file');
const body = $('#members-body');
const notice = $('#notice');
const state = { members: [], selected: new Set(), editingId: null, sourceName: '' };
const filters = [
  {selector: '#locality-filter', key: 'localidade', all: 'Todas as localidades', plural: 'localidades'},
  {selector: '#instrument-filter', key: 'instrumento', all: 'Todos os instrumentos', plural: 'instrumentos'},
  {selector: '#level-filter', key: 'nivel', all: 'Todos os níveis', plural: 'níveis'}
];

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const tidy = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const lowercaseWords = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos']);
const romanNumerals = new Set(['ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii']);

function pleasantCase(value) {
  return tidy(value).toLocaleLowerCase('pt-BR').replace(/\p{L}+/gu, (word, index) => {
    if (word === 'rjm' || word === 'ccb' || romanNumerals.has(word)) return word.toLocaleUpperCase('pt-BR');
    if (index > 0 && lowercaseWords.has(word)) return word;
    return word[0].toLocaleUpperCase('pt-BR') + word.slice(1);
  });
}

function showNotice(message, kind = '') {
  notice.textContent = message;
  notice.className = `notice ${kind}`.trim();
  notice.hidden = !message;
}

function repairKnownEncoding(value) {
  return tidy(value)
    .replace(/M�SICO/gi, 'MÚSICO')
    .replace(/�RG�O/gi, 'ÓRGÃO')
    .replace(/BAR�TONO/gi, 'BARÍTONO')
    .replace(/AC�CIO/gi, 'ACÁCIO')
    .replace(/S�RGIO/gi, 'SÉRGIO')
    .replace(/JOS�/gi, 'JOSÉ');
}

function groupTextItems(items) {
  const rows = [];
  for (const item of items) {
    const text = tidy(item.str);
    if (!text) continue;
    const x = item.transform[4], y = item.transform[5];
    let row = rows.find(entry => Math.abs(entry.y - y) < 2.7);
    if (!row) { row = {y, items: []}; rows.push(row); }
    row.items.push({x, text});
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach(row => row.items.sort((a, b) => a.x - b.x));
  return rows;
}

function columnStarts(header, width) {
  const fallbacks = [0, width * .335, width * .496, width * .715, width * .866];
  if (!header) return fallbacks;
  const labels = ['NOME', 'INSTRUMENTO', 'LOCALIDADE', 'CARGO', 'NIVEL'];
  return labels.map((label, index) => {
    const found = header.items.find(item => normalize(item.text).startsWith(label));
    return found?.x ?? fallbacks[index];
  });
}

function parsePageRows(rows, pageWidth) {
  const headerIndex = rows.findIndex(row => {
    const line = normalize(row.items.map(item => item.text).join(' '));
    return line.includes('NOME') && line.includes('INSTRUMENTO') && line.includes('LOCALIDADE');
  });
  if (headerIndex < 0) return [];
  const starts = columnStarts(rows[headerIndex], pageWidth);
  const breaks = starts.slice(1).map((x, index) => index === 0 ? x - 6 : x - 5);
  const result = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const full = normalize(row.items.map(item => item.text).join(' '));
    if (full.startsWith('TOTAL:') || full.startsWith('PAGINA ')) continue;
    const cols = ['', '', '', '', ''];
    for (const item of row.items) {
      const column = breaks.findIndex(boundary => item.x < boundary);
      const index = column < 0 ? 4 : column;
      cols[index] = `${cols[index]} ${item.text}`.trim();
    }
    const [nome, instrumento, localidade, cargo, nivel] = cols.map(value => pleasantCase(repairKnownEncoding(value)));
    if (!nome || !instrumento || !localidade || !cargo) continue;
    if (normalize(nome) === 'NOME' || /^\d+$/.test(nome)) continue;
    result.push({nome, instrumento, localidade, cargo, nivel, municipio: '', encarregado: '', manualEncarregado: false});
  }
  return result;
}

function suggestEncarregado(member, members) {
  const sameLocality = members.filter(person => normalize(person.localidade) === normalize(member.localidade));
  const local = sameLocality.find(person => normalize(person.cargo).includes('ENCARREGADO LOCAL'));
  const regional = sameLocality.find(person => normalize(person.cargo).includes('ENCARREGADO REGIONAL'));
  return (local || regional)?.nome || '';
}

function updateSuggestions() {
  state.members.forEach(member => {
    if (!member.manualEncarregado) member.encarregado = suggestEncarregado(member, state.members);
  });
}

async function importReport(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return showNotice('Selecione um arquivo PDF.', 'error');
  showNotice('Lendo o relatório…');
  reportInput.disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 100 || new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('O arquivo não contém um PDF válido. Exporte o relatório novamente.');
    const document = await pdfjsLib.getDocument({data: bytes, useSystemFonts: true}).promise;
    const members = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      members.push(...parsePageRows(groupTextItems(content.items), page.view[2] - page.view[0]));
    }
    if (!members.length) throw new Error('Não encontrei a tabela de membros neste PDF. Verifique se é o relatório exportado pelo Sistema de Gerenciamento Musical.');
    state.members = members.map((member, index) => ({...member, id: index + 1}));
    state.selected.clear();
    state.sourceName = file.name;
    updateSuggestions();
    fillFilters();
    render();
    $('#file-info').textContent = `${file.name} · ${document.numPages} ${document.numPages === 1 ? 'página' : 'páginas'}`;
    const candidates = state.members.filter(member => normalize(member.nivel).includes('CANDIDATO')).length;
    showNotice(`${state.members.length} membros importados; ${candidates} com nível Candidato(a). O relatório não inclui município: preencha antes de gerar as fichas.`, 'success');
    await document.destroy();
  } catch (error) {
    console.error(error);
    showNotice(error.message || 'Não foi possível ler este PDF.', 'error');
  } finally { reportInput.disabled = false; reportInput.value = ''; }
}

function selectedFilterValues(selector) {
  return new Set([...$(selector).querySelectorAll('.filter-options input:checked')].map(input => input.value));
}

function fillFilters(preserve = false) {
  for (const {selector, key} of filters) {
    const menu = $(selector);
    const previous = preserve ? selectedFilterValues(selector) : new Set();
    const values = [...new Set(state.members.map(member => member[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    menu.querySelector('.filter-options').innerHTML = values.map(value => `<label class="filter-option"><input type="checkbox" value="${escapeHtml(value)}" ${previous.has(value) ? 'checked' : ''}><span>${escapeHtml(pleasantCase(value))}</span></label>`).join('');
    menu.inert = false;
    menu.open = false;
  }
  $('#search').disabled = false;
  $('#select-visible').disabled = false;
  if (!preserve) $('#search').value = '';
}

function visibleMembers() {
  const search = normalize($('#search').value);
  const choices = Object.fromEntries(filters.map(({selector, key}) => [key, selectedFilterValues(selector)]));
  return state.members.filter(member => {
    if (filters.some(({key}) => choices[key].size && !choices[key].has(member[key]))) return false;
    return !search || normalize([member.nome, member.instrumento, member.localidade, member.cargo, member.nivel].join(' ')).includes(search);
  });
}

function updateFilterSummaries() {
  for (const {selector, all, plural} of filters) {
    const values = selectedFilterValues(selector);
    const label = values.size === 0 ? all : values.size === 1 ? pleasantCase([...values][0]) : `${values.size} ${plural}`;
    $(selector).querySelector('summary span').textContent = label;
    $(selector).querySelector('.filter-clear').disabled = values.size === 0;
  }
}

function render() {
  const shown = visibleMembers();
  updateFilterSummaries();
  body.innerHTML = shown.length ? shown.map(member => `<tr class="${state.selected.has(member.id) ? 'selected' : ''}"><td class="check-cell"><input type="checkbox" data-id="${member.id}" aria-label="Selecionar ${escapeHtml(pleasantCase(member.nome))}" ${state.selected.has(member.id) ? 'checked' : ''}></td><td class="name" data-label="Nome">${escapeHtml(pleasantCase(member.nome))}</td><td data-label="Instrumento">${escapeHtml(pleasantCase(member.instrumento))}</td><td data-label="Localidade">${escapeHtml(pleasantCase(member.localidade))}</td><td data-label="Cargo / Ministério">${escapeHtml(pleasantCase(member.cargo))}</td><td data-label="Nível"><span class="pill ${normalize(member.nivel).includes('CANDIDATO') ? 'candidate' : ''}">${escapeHtml(pleasantCase(member.nivel || '—'))}</span></td><td class="action-cell"><button class="row-action" type="button" data-edit="${member.id}">Conferir dados</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="7"><div class="empty-state"><strong>Nenhum membro encontrado</strong><p>Ajuste os filtros ou importe outro relatório.</p></div></td></tr>`;
  $('#count-badge').textContent = `${state.members.length} ${state.members.length === 1 ? 'membro' : 'membros'}`;
  $('#visible-count').textContent = `${shown.length} ${shown.length === 1 ? 'resultado' : 'resultados'}`;
  $('#selected-count').textContent = state.selected.size;
  $('#selected-label').textContent = state.selected.size === 1 ? 'selecionado' : 'selecionados';
  $('#stat-total').textContent = state.members.length;
  $('#stat-candidates').textContent = state.members.filter(member => normalize(member.nivel).includes('CANDIDATO')).length;
  $('#stat-localities').textContent = new Set(state.members.map(member => normalize(member.localidade)).filter(Boolean)).size;
  $('#stat-selected').textContent = state.selected.size;
  ['#download-pdf', '#print-fichas', '#clear-selection'].forEach(selector => $(selector).disabled = state.selected.size === 0);
  const checked = shown.filter(member => state.selected.has(member.id)).length;
  $('#select-visible').checked = shown.length > 0 && checked === shown.length;
  $('#select-visible').indeterminate = checked > 0 && checked < shown.length;
  $('#select-visible-mobile').disabled = shown.length === 0;
  $('#select-visible-mobile').textContent = shown.length > 0 && checked === shown.length ? 'Desmarcar visíveis' : 'Selecionar visíveis';
}

function openEditor(member) {
  state.editingId = member.id;
  const form = $('#edit-form');
  for (const key of ['nome', 'instrumento', 'localidade', 'municipio', 'encarregado']) form.elements[key].value = pleasantCase(member[key] || '');
  $('#edit-dialog').showModal();
}

function safeText(font, input) {
  let result = '';
  for (const char of tidy(input)) {
    try { font.encodeText(char); result += char; } catch { result += char === '�' ? '?' : ''; }
  }
  return result;
}

function drawFitted(page, font, value, x, y, maxWidth) {
  let text = safeText(font, pleasantCase(value));
  if (!text) return;
  let size = 9;
  while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= .25;
  while (font.widthOfTextAtSize(text, size) > maxWidth && text.length > 4) text = text.slice(0, -4) + '...';
  page.drawText(text, {x, y, font, size, color: PDFLib.rgb(.08, .13, .11)});
}

function drawFields(page, font, member, dateText, offset) {
  drawFitted(page, font, member.nome, 28, 770.5 - offset, 257);
  drawFitted(page, font, member.instrumento, 300, 770.5 - offset, 182);
  drawFitted(page, font, dateText, 497, 770.5 - offset, 67);
  drawFitted(page, font, member.localidade, 28, 751.2 - offset, 147);
  drawFitted(page, font, member.municipio, 188, 751.2 - offset, 137);
  drawFitted(page, font, member.encarregado, 339, 751.2 - offset, 222);
}

function selectedForOutput() {
  const selected = state.members.filter(member => state.selected.has(member.id));
  if (!selected.length) return null;
  const sharedMunicipality = pleasantCase($('#municipality-all').value);
  if (sharedMunicipality) selected.filter(member => !member.municipio).forEach(member => member.municipio = sharedMunicipality);
  const missing = selected.filter(member => !tidy(member.municipio));
  if (missing.length) {
    showNotice(`Informe o município de ${missing.length} ${missing.length === 1 ? 'selecionado' : 'selecionados'} antes de gerar as fichas. Use o campo abaixo ou “Editar” em cada linha.`, 'error');
    $('#municipality-all').focus();
    return null;
  }
  return selected;
}

function testDateText() {
  const value = $('#test-date').value;
  return value ? value.split('-').reverse().join('/') : '';
}

async function templateBytes() {
  const response = await fetch('inspiracoes/ficha-base.jpg');
  if (!response.ok) throw new Error('Não foi possível carregar o modelo da ficha. Abra o site pelo servidor local.');
  return response.arrayBuffer();
}

async function createPdf(selected, dateText) {
  const pdfDocument = await PDFLib.PDFDocument.create();
  const image = await pdfDocument.embedJpg(await templateBytes());
  const font = await pdfDocument.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let index = 0; index < selected.length; index += 2) {
    const page = pdfDocument.addPage([595.2, 841.8]);
    page.drawImage(image, {x: 0, y: 0, width: 595.2, height: 841.8});
    drawFields(page, font, selected[index], dateText, 0);
    if (selected[index + 1]) drawFields(page, font, selected[index + 1], dateText, 414.4);
  }
  return new Blob([await pdfDocument.save()], {type: 'application/pdf'});
}

function drawCanvasText(context, value, x, y, maxWidth, scale) {
  let text = pleasantCase(value).replace(/�/g, '?');
  if (!text) return;
  let size = 9;
  context.font = `${size * scale}px Arial, sans-serif`;
  while (size > 6 && context.measureText(text).width > maxWidth * scale) {
    size -= .25;
    context.font = `${size * scale}px Arial, sans-serif`;
  }
  while (text.length > 4 && context.measureText(text).width > maxWidth * scale) text = text.slice(0, -4) + '...';
  context.fillText(text, x * scale, (841.8 - y) * scale);
}

function drawCanvasFields(context, member, dateText, offset, scale) {
  drawCanvasText(context, member.nome, 28, 770.5 - offset, 257, scale);
  drawCanvasText(context, member.instrumento, 300, 770.5 - offset, 182, scale);
  drawCanvasText(context, dateText, 497, 770.5 - offset, 67, scale);
  drawCanvasText(context, member.localidade, 28, 751.2 - offset, 147, scale);
  drawCanvasText(context, member.municipio, 188, 751.2 - offset, 137, scale);
  drawCanvasText(context, member.encarregado, 339, 751.2 - offset, 222, scale);
}

async function createPageImages(selected, dateText) {
  const imageUrl = URL.createObjectURL(new Blob([await templateBytes()], {type: 'image/jpeg'}));
  const template = new Image();
  template.src = imageUrl;
  try { await template.decode(); } finally { URL.revokeObjectURL(imageUrl); }
  const images = [];
  const scale = template.naturalWidth / 595.2;
  for (let index = 0; index < selected.length; index += 2) {
    const canvas = document.createElement('canvas');
    canvas.width = template.naturalWidth;
    canvas.height = template.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('O navegador não conseguiu preparar a página para impressão.');
    context.drawImage(template, 0, 0);
    context.fillStyle = '#14211c';
    context.textBaseline = 'alphabetic';
    drawCanvasFields(context, selected[index], dateText, 0, scale);
    if (selected[index + 1]) drawCanvasFields(context, selected[index + 1], dateText, 414.4, scale);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
    if (!blob) throw new Error('Não foi possível criar a imagem da ficha.');
    images.push(blob);
  }
  return images;
}

function saveBlob(blob, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const localDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  link.href = url;
  link.download = `fichas-avaliacao-${localDate}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function printImages(images) {
  const sheet = document.createElement('div');
  sheet.id = 'print-pages';
  const urls = images.map(image => URL.createObjectURL(image));
  const cleanup = () => { sheet.remove(); urls.forEach(url => URL.revokeObjectURL(url)); };
  try {
    urls.forEach(url => { const image = new Image(); image.src = url; image.alt = 'Ficha de avaliação'; sheet.append(image); });
    document.body.append(sheet);
    await Promise.all([...sheet.querySelectorAll('img')].map(image => image.decode()));
    window.addEventListener('afterprint', cleanup, {once: true});
    window.print();
    setTimeout(cleanup, 120000);
  } catch (error) { cleanup(); throw error; }
}

async function runOutput(kind) {
  const selected = selectedForOutput();
  if (!selected) return;
  const buttons = ['#download-pdf', '#print-fichas', '#clear-selection'].map($);
  buttons.forEach(button => button.disabled = true);
  showNotice('Preparando as fichas…');
  try {
    const dateText = testDateText();
    if (kind === 'pdf') saveBlob(await createPdf(selected, dateText), 'pdf');
    else await printImages(await createPageImages(selected, dateText));
    showNotice(kind === 'print' ? 'A janela de impressão foi aberta. Confira o papel A4 antes de imprimir.' : `${selected.length} ${selected.length === 1 ? 'ficha preparada' : 'fichas preparadas'} para download em ${kind.toUpperCase()}.`, 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || 'Não foi possível preparar as fichas.', 'error');
  } finally { buttons.forEach(button => button.disabled = state.selected.size === 0); }
}

reportInput.addEventListener('change', event => importReport(event.target.files[0]));
$('#search').addEventListener('input', render);
for (const {selector} of filters) {
  const menu = $(selector);
  menu.addEventListener('change', render);
  menu.querySelector('.filter-clear').addEventListener('click', () => {
    menu.querySelectorAll('.filter-options input:checked').forEach(input => input.checked = false);
    render();
  });
  menu.addEventListener('toggle', () => {
    if (menu.open) filters.forEach(other => { if (other.selector !== selector) $(other.selector).open = false; });
  });
}
document.addEventListener('click', event => {
  if (!event.target.closest('.filter-menu')) filters.forEach(({selector}) => $(selector).open = false);
});
$('#select-visible').addEventListener('change', event => { visibleMembers().forEach(member => event.target.checked ? state.selected.add(member.id) : state.selected.delete(member.id)); render(); });
$('#select-visible-mobile').addEventListener('click', () => { const shown = visibleMembers(); const allSelected = shown.every(member => state.selected.has(member.id)); shown.forEach(member => allSelected ? state.selected.delete(member.id) : state.selected.add(member.id)); render(); });
body.addEventListener('change', event => { const id = Number(event.target.dataset.id); if (!id) return; event.target.checked ? state.selected.add(id) : state.selected.delete(id); render(); });
body.addEventListener('click', event => { const id = Number(event.target.dataset.edit); if (id) openEditor(state.members.find(member => member.id === id)); });
$('#municipality-all').addEventListener('input', event => { const municipality = pleasantCase(event.target.value); if (!municipality) return; state.members.filter(member => state.selected.has(member.id)).forEach(member => member.municipio = municipality); });
$('#municipality-all').addEventListener('blur', event => { event.target.value = pleasantCase(event.target.value); });
$('#edit-form').addEventListener('submit', event => { event.preventDefault(); const member = state.members.find(person => person.id === state.editingId); if (!member) return; const form = event.currentTarget; for (const key of ['nome', 'instrumento', 'localidade', 'municipio', 'encarregado']) member[key] = pleasantCase(form.elements[key].value); member.manualEncarregado = Boolean(member.encarregado); updateSuggestions(); fillFilters(true); $('#edit-dialog').close(); render(); });
$('#close-dialog').addEventListener('click', () => $('#edit-dialog').close());
$('#cancel-edit').addEventListener('click', () => $('#edit-dialog').close());
$('#download-pdf').addEventListener('click', () => runOutput('pdf'));
$('#print-fichas').addEventListener('click', () => runOutput('print'));
$('#clear-selection').addEventListener('click', () => { state.selected.clear(); render(); showNotice('Todos os candidatos foram desmarcados.', 'success'); });
