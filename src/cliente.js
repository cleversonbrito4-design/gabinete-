/* global __CLIENTE__ */
// Dados do cliente (gabinete) para quem este site foi gerado: vêm de clientes/<nome>/cliente.json,
// colocados aqui pelo vite.config.js na hora do "npm run build".
const C = typeof __CLIENTE__ !== 'undefined' ? __CLIENTE__ : {};

export const CLIENTE = C;
export const MARCA = C.marca || 'Gestão do Gabinete';
export const SITE = C.site || '';
export const HASHTAGS = C.hashtags || [];
export const CIDADE = C.cidade || '';
export const UF = C.uf || '';
export const DDD = C.ddd || '00';
export const ESTADO = C.estado || '';
// "Estado do Paraná", "Estado da Bahia", "Estado de São Paulo" (pode ser trocado por "estado_de" no cliente.json)
const ART = { AC: 'do', AP: 'do', AM: 'do', CE: 'do', ES: 'do', MA: 'do', PA: 'do', PR: 'do', PI: 'do', RJ: 'do', RN: 'do', RS: 'do', TO: 'do', BA: 'da', PB: 'da' };
export const ESTADO_DE = C.estado_de || (ESTADO ? `Estado ${ART[UF] || 'de'} ${ESTADO}` : 'Estado');
export const GAB = C.gabinete || {};
export const BAIRROS = C.bairros || [];
export const ORGAOS = C.orgaos || [];
export const MAPA_CENTRO = (C.mapa && C.mapa.centro) || [-15.78, -47.93];
export const MAPA_AREA = (C.mapa && C.mapa.area) || null;
export const SUPABASE = C.supabase || {};
