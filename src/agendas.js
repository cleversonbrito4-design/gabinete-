// Agenda ligada a outras agendas.
// • Do sistema para fora: um link iCal (assinatura) que o Google Agenda, Outlook ou
//   iPhone leem sozinhos, e um botão "Google Agenda" em cada compromisso.
// • De fora para o sistema: endereços iCal de outras agendas (Gmail, Outlook, iCloud…)
//   que a função "agenda" do Supabase lê e mostra aqui, só para consulta.

export const CORES = ['#ea4335', '#0b8043', '#8e24aa', '#f09300', '#039be5', '#d81b60', '#616161'];

const ics = d => d.replace(/-/g, '');
function mais1h(t) { const [h, m] = t.split(':').map(Number); return String(Math.min(h + 1, 23)).padStart(2, '0') + ':' + String(h + 1 > 23 ? 59 : m).padStart(2, '0'); }
function diaSeguinte(d) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); }

/** Link "Adicionar ao Google Agenda" para um compromisso (abre a tela do Google já preenchida). */
export function linkGoogleEvento(r) {
  const h = t => (t || '').slice(0, 5);
  let dates;
  if (h(r.inicio)) { const fim = h(r.fim) && h(r.fim) > h(r.inicio) ? h(r.fim) : mais1h(h(r.inicio)); dates = `${ics(r.data)}T${h(r.inicio).replace(':', '')}00/${ics(r.data)}T${fim.replace(':', '')}00`; }
  else dates = `${ics(r.data)}/${ics(diaSeguinte(r.data))}`;
  const det = [r.tipo && 'Tipo: ' + r.tipo, r.contato && 'Contato: ' + r.contato, r.acompanha && 'Acompanha: ' + r.acompanha, r.pauta].filter(Boolean).join('\n');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: r.titulo || 'Compromisso', dates, ctz: 'America/Sao_Paulo' });
  const loc = [r.local, r.municipio].filter(Boolean).join(' – ');
  if (loc) q.set('location', loc);
  if (det) q.set('details', det);
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

/** Link que abre o Google Agenda já perguntando "Adicionar esta agenda?". */
export const linkAssinarGoogle = url => 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(url.replace(/^https:\/\//, 'webcal://'));
export const linkWebcal = url => url.replace(/^https:\/\//, 'webcal://');
/** Outlook (conta Microsoft pessoal ou do trabalho): abre "Adicionar calendário da Internet". */
export const linkAssinarOutlook = url => 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent('Agenda do gabinete');
