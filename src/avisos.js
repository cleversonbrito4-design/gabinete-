// Avisos no celular/computador antes dos compromissos (notificação push).
// O aparelho se inscreve uma vez; o servidor (função "avisos") manda o aviso
// ~30 minutos antes de cada compromisso, mesmo com o sistema fechado.
import * as store from './store.js';

const b64ParaBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
export const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// 'sem' (aparelho não aceita) | 'instalar' (iPhone fora do app instalado) | 'bloqueado' | 'ligado' | 'desligado'
export async function situacao() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return ehIphone() && !instalado() ? 'instalar' : 'sem';
  if (Notification.permission === 'denied') return 'bloqueado';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'ligado' : 'desligado';
  } catch { return 'desligado'; }
}

export async function ligar() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Os avisos foram bloqueados. Libere as notificações deste site nas configurações do celular e tente de novo.');
  const reg = await navigator.serviceWorker.ready;
  const { publica } = await store.avisosFn('chave');
  let sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe().catch(() => {}); // recomeça limpo (a chave pode ter mudado)
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(publica) });
  await store.avisosFn('inscrever', { sub: sub.toJSON(), aparelho: navigator.userAgent.slice(0, 120) });
  await store.avisosFn('testar', { endpoint: sub.endpoint });
}

export async function testar() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Os avisos estão desligados neste aparelho.');
  await store.avisosFn('testar', { endpoint: sub.endpoint });
}

export async function desligar() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await store.avisosFn('cancelar', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
