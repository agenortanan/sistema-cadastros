'use strict';
/**
 * Sistema de Cadastros — servidor
 * Sem dependências externas: usa apenas módulos nativos do Node (>= 22.13).
 *  - http            → servidor web + API JSON
 *  - node:sqlite     → banco de dados (arquivo dados.db)
 *  - crypto (scrypt) → hash de senhas
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
// No Render (variável RENDER=true) o servidor precisa escutar em todas as interfaces.
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'dados.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSAO_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ *
 * Definição dos cadastros
 * Para criar um novo cadastro, basta adicionar uma entrada aqui:
 * a tabela, a API e as telas são geradas a partir desta definição.
 * Tipos: text | email | textarea | number | select | ref
 * ------------------------------------------------------------------ */
const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'M²', 'CX', 'PC'];

const ENTITIES = {
  clientes: {
    titulo: 'Clientes',
    singular: 'Cliente',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'text', obrigatorio: true, lista: true },
      { nome: 'documento', rotulo: 'CPF/CNPJ', tipo: 'text', lista: true },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', lista: true },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'text', lista: true },
      { nome: 'endereco', rotulo: 'Endereço', tipo: 'text' },
      { nome: 'cidade', rotulo: 'Cidade', tipo: 'text', lista: true },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
    ],
  },
  fornecedores: {
    titulo: 'Fornecedores',
    singular: 'Fornecedor',
    campos: [
      { nome: 'nome', rotulo: 'Nome / Razão social', tipo: 'text', obrigatorio: true, lista: true },
      { nome: 'documento', rotulo: 'CNPJ', tipo: 'text', lista: true },
      { nome: 'contato', rotulo: 'Pessoa de contato', tipo: 'text', lista: true },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', lista: true },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'text', lista: true },
      { nome: 'endereco', rotulo: 'Endereço', tipo: 'text' },
      { nome: 'cidade', rotulo: 'Cidade', tipo: 'text' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
    ],
  },
  produtos: {
    titulo: 'Produtos',
    singular: 'Produto',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'text', obrigatorio: true, lista: true },
      { nome: 'codigo', rotulo: 'Código / SKU', tipo: 'text', lista: true },
      { nome: 'unidade', rotulo: 'Unidade', tipo: 'select', opcoes: UNIDADES, obrigatorio: true, lista: true },
      { nome: 'preco', rotulo: 'Preço de venda', tipo: 'number', formato: 'dinheiro', lista: true },
      { nome: 'estoque', rotulo: 'Estoque', tipo: 'number', lista: true },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' },
    ],
  },
  materiais: {
    titulo: 'Materiais',
    singular: 'Material',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'text', obrigatorio: true, lista: true },
      { nome: 'codigo', rotulo: 'Código', tipo: 'text', lista: true },
      { nome: 'unidade', rotulo: 'Unidade', tipo: 'select', opcoes: UNIDADES, obrigatorio: true, lista: true },
      { nome: 'custo', rotulo: 'Custo unitário', tipo: 'number', formato: 'dinheiro', lista: true },
      { nome: 'estoque', rotulo: 'Estoque', tipo: 'number', lista: true },
      { nome: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'ref', ref: 'fornecedores', lista: true },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
    ],
  },
};

const CONFIG_FIELDS = [
  { nome: 'empresa_nome', rotulo: 'Nome da empresa', tipo: 'text', grupo: 'empresa' },
  { nome: 'empresa_documento', rotulo: 'CNPJ', tipo: 'text', grupo: 'empresa' },
  { nome: 'empresa_email', rotulo: 'E-mail', tipo: 'email', grupo: 'empresa' },
  { nome: 'empresa_telefone', rotulo: 'Telefone', tipo: 'text', grupo: 'empresa' },
  { nome: 'empresa_endereco', rotulo: 'Endereço', tipo: 'text', grupo: 'empresa' },
  {
    nome: 'moeda', rotulo: 'Moeda', tipo: 'select', grupo: 'preferencias', padrao: 'BRL',
    opcoes: [{ valor: 'BRL', rotulo: 'Real (R$)' }, { valor: 'USD', rotulo: 'Dólar (US$)' }, { valor: 'EUR', rotulo: 'Euro (€)' }],
  },
  {
    nome: 'tema', rotulo: 'Tema', tipo: 'select', grupo: 'preferencias', padrao: 'sistema',
    opcoes: [{ valor: 'sistema', rotulo: 'Automático (do sistema)' }, { valor: 'claro', rotulo: 'Claro' }, { valor: 'escuro', rotulo: 'Escuro' }],
  },
];

const SCHEMA = {
  entidades: Object.entries(ENTITIES).map(([chave, e]) => ({ chave, ...e })),
  config: CONFIG_FIELDS,
  // Aviso opcional exibido na tela (usado em hospedagens onde o disco é temporário)
  aviso: process.env.AVISO_DEMO || null,
};

/* ------------------------------------------------------------------ *
 * Banco de dados
 * ------------------------------------------------------------------ */
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS configuracoes (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    chave TEXT NOT NULL,
    valor TEXT,
    PRIMARY KEY (usuario_id, chave)
  );
`);

for (const [tabela, ent] of Object.entries(ENTITIES)) {
  const colunas = ent.campos.map((f) => {
    if (f.tipo === 'number') return `${f.nome} REAL`;
    if (f.tipo === 'ref') return `${f.nome} INTEGER REFERENCES ${f.ref}(id) ON DELETE SET NULL`;
    return `${f.nome} TEXT`;
  });
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tabela} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      ${colunas.join(',\n      ')},
      criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_${tabela}_usuario ON ${tabela}(usuario_id);
  `);
}

setInterval(() => {
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
}, 60 * 60 * 1000).unref();
db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */
function httpError(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function send(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SEC_HEADERS,
  });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > MAX_BODY) {
        reject(httpError(413, 'Requisição muito grande.'));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8')));
      } catch {
        reject(httpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return out;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(senha, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function confereSenha(senha, guardada) {
  const [saltHex, hashHex] = guardada.split(':');
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = await scrypt(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(hash, esperado);
}

let SENHA_FALSA = null; // usada para manter o tempo de resposta quando o e-mail não existe

// Limite de tentativas de login (em memória): 5 falhas / 15 min por IP + e-mail
const falhas = new Map();
function checaLimite(chave) {
  const f = falhas.get(chave);
  if (f && f.n >= 5 && f.ate > Date.now()) {
    throw httpError(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
  }
}
function registraFalha(chave) {
  const f = falhas.get(chave);
  if (!f || f.ate <= Date.now()) falhas.set(chave, { n: 1, ate: Date.now() + 15 * 60 * 1000 });
  else f.n += 1;
}

function criaSessao(req, res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(sha256(token), usuarioId, Date.now() + SESSAO_MS);
  defineCookie(req, res, token, SESSAO_MS / 1000);
}

function defineCookie(req, res, valor, maxAgeSeg) {
  const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeSeg)}${seguro}`);
}

function usuarioAtual(req) {
  const token = parseCookies(req).sid;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = sha256(token);
  const u = db.prepare(`
    SELECT u.id, u.nome, u.email, s.expira_em
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?`).get(tokenHash);
  if (!u) return null;
  if (u.expira_em < Date.now()) {
    db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { id: u.id, nome: u.nome, email: u.email, tokenHash };
}

function exigeUsuario(req) {
  const u = usuarioAtual(req);
  if (!u) throw httpError(401, 'Não autenticado.');
  return u;
}

const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email });
const valoresDe = (f) => (f.opcoes || []).map((o) => (typeof o === 'string' ? o : o.valor));

/* ------------------------------------------------------------------ *
 * Autenticação
 * ------------------------------------------------------------------ */
async function rotasAuth(req, res, acao, corpo) {
  const m = req.method;

  if (acao === 'me' && m === 'GET') {
    const u = usuarioAtual(req);
    return send(res, 200, { usuario: u ? publico(u) : null });
  }

  if (acao === 'register' && m === 'POST') {
    const nome = String(corpo.nome || '').trim();
    const email = String(corpo.email || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');
    if (nome.length < 2 || nome.length > 100) throw httpError(400, 'Informe seu nome (2 a 100 caracteres).');
    if (!EMAIL_RE.test(email) || email.length > 200) throw httpError(400, 'E-mail inválido.');
    if (senha.length < 8) throw httpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
    if (senha.length > 200) throw httpError(400, 'Senha muito longa.');
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
      throw httpError(409, 'Já existe uma conta com esse e-mail.');
    }
    const r = db.prepare('INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)')
      .run(nome, email, await hashSenha(senha));
    const id = Number(r.lastInsertRowid);
    criaSessao(req, res, id);
    return send(res, 201, { usuario: { id, nome, email } });
  }

  if (acao === 'login' && m === 'POST') {
    const email = String(corpo.email || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');
    const chave = `${req.socket.remoteAddress}|${email}`;
    checaLimite(chave);
    const u = db.prepare('SELECT id, nome, email, senha FROM usuarios WHERE email = ?').get(email);
    let ok = false;
    if (u) {
      ok = await confereSenha(senha, u.senha);
    } else {
      SENHA_FALSA = SENHA_FALSA || (await hashSenha('senha-falsa'));
      await confereSenha(senha, SENHA_FALSA);
    }
    if (!ok) {
      registraFalha(chave);
      throw httpError(401, 'E-mail ou senha incorretos.');
    }
    falhas.delete(chave);
    criaSessao(req, res, u.id);
    return send(res, 200, { usuario: publico(u) });
  }

  if (acao === 'logout' && m === 'POST') {
    const u = usuarioAtual(req);
    if (u) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(u.tokenHash);
    defineCookie(req, res, '', 0);
    return send(res, 200, { ok: true });
  }

  if (acao === 'senha' && m === 'POST') {
    const u = exigeUsuario(req);
    const atual = String(corpo.atual || '');
    const nova = String(corpo.nova || '');
    if (nova.length < 8) throw httpError(400, 'A nova senha precisa ter pelo menos 8 caracteres.');
    if (nova.length > 200) throw httpError(400, 'Senha muito longa.');
    const linha = db.prepare('SELECT senha FROM usuarios WHERE id = ?').get(u.id);
    if (!(await confereSenha(atual, linha.senha))) throw httpError(400, 'A senha atual está incorreta.');
    db.prepare('UPDATE usuarios SET senha = ? WHERE id = ?').run(await hashSenha(nova), u.id);
    // encerra as outras sessões desta conta
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash != ?').run(u.id, u.tokenHash);
    return send(res, 200, { ok: true });
  }

  throw httpError(404, 'Rota não encontrada.');
}

/* ------------------------------------------------------------------ *
 * Configurações
 * ------------------------------------------------------------------ */
function lerConfig(usuarioId) {
  const cfg = {};
  for (const f of CONFIG_FIELDS) cfg[f.nome] = f.padrao ?? '';
  for (const r of db.prepare('SELECT chave, valor FROM configuracoes WHERE usuario_id = ?').all(usuarioId)) {
    if (r.chave in cfg) cfg[r.chave] = r.valor ?? '';
  }
  return cfg;
}

function rotasConfig(req, res, usuario, corpo) {
  if (req.method === 'GET') return send(res, 200, { config: lerConfig(usuario.id) });
  if (req.method !== 'PUT') throw httpError(405, 'Método não permitido.');

  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw httpError(400, 'Dados inválidos.');
  const novos = [];
  for (const f of CONFIG_FIELDS) {
    if (!(f.nome in corpo)) continue;
    const v = String(corpo[f.nome] ?? '').trim();
    if (v.length > 200) throw httpError(400, `${f.rotulo} é muito longo.`);
    if (f.tipo === 'email' && v && !EMAIL_RE.test(v)) throw httpError(400, `${f.rotulo} inválido.`);
    if (f.tipo === 'select' && !valoresDe(f).includes(v)) throw httpError(400, `${f.rotulo} inválido.`);
    novos.push([f.nome, v]);
  }
  const up = db.prepare(`
    INSERT INTO configuracoes (usuario_id, chave, valor) VALUES (?, ?, ?)
    ON CONFLICT(usuario_id, chave) DO UPDATE SET valor = excluded.valor`);
  db.exec('BEGIN');
  try {
    for (const [k, v] of novos) up.run(usuario.id, k, v);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return send(res, 200, { config: lerConfig(usuario.id) });
}

/* ------------------------------------------------------------------ *
 * Cadastros (CRUD genérico)
 * ------------------------------------------------------------------ */
function limpar(ent, entrada, usuarioId) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw httpError(400, 'Dados inválidos.');
  const saida = {};
  for (const f of ent.campos) {
    let v = entrada[f.nome];
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === null || v === '') {
      if (f.obrigatorio) throw httpError(400, `${f.rotulo} é obrigatório.`);
      saida[f.nome] = null;
      continue;
    }
    if (typeof v !== 'string' && typeof v !== 'number') throw httpError(400, `${f.rotulo} inválido.`);
    switch (f.tipo) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 1e12) {
          throw httpError(400, `${f.rotulo} deve ser um número válido (zero ou maior).`);
        }
        v = n;
        break;
      }
      case 'ref': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) throw httpError(400, `${f.rotulo} inválido.`);
        const existe = db.prepare(`SELECT 1 FROM ${f.ref} WHERE id = ? AND usuario_id = ?`).get(n, usuarioId);
        if (!existe) throw httpError(400, `${f.rotulo} inválido.`);
        v = n;
        break;
      }
      case 'select':
        v = String(v);
        if (!valoresDe(f).includes(v)) throw httpError(400, `${f.rotulo} inválido.`);
        break;
      case 'email':
        v = String(v);
        if (!EMAIL_RE.test(v) || v.length > 200) throw httpError(400, `${f.rotulo} inválido.`);
        break;
      default:
        v = String(v);
        if (v.length > (f.tipo === 'textarea' ? 2000 : 200)) throw httpError(400, `${f.rotulo} é muito longo.`);
    }
    saida[f.nome] = v;
  }
  return saida;
}

function selectBase(chave, ent) {
  const refs = ent.campos.filter((f) => f.tipo === 'ref');
  const extra = refs.map((f) => `r_${f.nome}.nome AS ${f.nome}_texto`);
  const joins = refs.map((f) => `LEFT JOIN ${f.ref} r_${f.nome} ON r_${f.nome}.id = t.${f.nome}`);
  return `SELECT ${['t.*', ...extra].join(', ')} FROM ${chave} t ${joins.join(' ')}`;
}

function rotasEntidade(req, res, usuario, chave, idSeg, corpo, url) {
  const ent = ENTITIES[chave];
  const m = req.method;

  // lista / criação
  if (!idSeg) {
    if (m === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      const tam = Math.min(100, Math.max(1, parseInt(url.searchParams.get('tam'), 10) || 25));
      const pagina = Math.max(1, parseInt(url.searchParams.get('pagina'), 10) || 1);
      let where = 't.usuario_id = ?';
      const params = [usuario.id];
      if (q) {
        const buscaveis = ent.campos.filter((f) => f.tipo === 'text' || f.tipo === 'email');
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where += ` AND (${buscaveis.map((f) => `t.${f.nome} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
        params.push(...buscaveis.map(() => like));
      }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ${chave} t WHERE ${where}`).get(...params).n;
      const itens = db.prepare(
        `${selectBase(chave, ent)} WHERE ${where} ORDER BY t.nome COLLATE NOCASE LIMIT ? OFFSET ?`,
      ).all(...params, tam, (pagina - 1) * tam);
      return send(res, 200, { itens, total, pagina, tam });
    }
    if (m === 'POST') {
      const dados = limpar(ent, corpo, usuario.id);
      const cols = Object.keys(dados);
      const r = db.prepare(
        `INSERT INTO ${chave} (usuario_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      ).run(usuario.id, ...cols.map((c) => dados[c]));
      const item = db.prepare(`${selectBase(chave, ent)} WHERE t.id = ?`).get(Number(r.lastInsertRowid));
      return send(res, 201, { item });
    }
    throw httpError(405, 'Método não permitido.');
  }

  // opções para listas de seleção (id + nome)
  if (idSeg === 'opcoes' && m === 'GET') {
    const itens = db.prepare(
      `SELECT id, nome FROM ${chave} WHERE usuario_id = ? ORDER BY nome COLLATE NOCASE LIMIT 1000`,
    ).all(usuario.id);
    return send(res, 200, { itens });
  }

  // item
  if (!/^\d+$/.test(idSeg)) throw httpError(404, 'Registro não encontrado.');
  const id = Number(idSeg);

  if (m === 'GET') {
    const item = db.prepare(`${selectBase(chave, ent)} WHERE t.id = ? AND t.usuario_id = ?`).get(id, usuario.id);
    if (!item) throw httpError(404, 'Registro não encontrado.');
    return send(res, 200, { item });
  }
  if (m === 'PUT') {
    const dados = limpar(ent, corpo, usuario.id);
    const cols = Object.keys(dados);
    const r = db.prepare(
      `UPDATE ${chave} SET ${cols.map((c) => `${c} = ?`).join(', ')}, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND usuario_id = ?`,
    ).run(...cols.map((c) => dados[c]), id, usuario.id);
    if (!r.changes) throw httpError(404, 'Registro não encontrado.');
    const item = db.prepare(`${selectBase(chave, ent)} WHERE t.id = ?`).get(id);
    return send(res, 200, { item });
  }
  if (m === 'DELETE') {
    const r = db.prepare(`DELETE FROM ${chave} WHERE id = ? AND usuario_id = ?`).run(id, usuario.id);
    if (!r.changes) throw httpError(404, 'Registro não encontrado.');
    return send(res, 200, { ok: true });
  }
  throw httpError(405, 'Método não permitido.');
}

/* ------------------------------------------------------------------ *
 * Roteamento
 * ------------------------------------------------------------------ */
async function rotasApi(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const [a, b, c] = seg;
  const m = req.method;

  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(m)) throw httpError(405, 'Método não permitido.');

  // proteção extra contra CSRF (além do cookie SameSite=Strict)
  if (m !== 'GET' && req.headers.origin) {
    let ok = false;
    try { ok = new URL(req.headers.origin).host === req.headers.host; } catch { ok = false; }
    if (!ok) throw httpError(403, 'Origem não permitida.');
  }

  let corpo = {};
  if (m === 'POST' || m === 'PUT') {
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      throw httpError(415, 'Use Content-Type: application/json.');
    }
    corpo = await readJson(req);
  }

  if (a === 'schema' && m === 'GET') return send(res, 200, SCHEMA);
  if (a === 'auth') return rotasAuth(req, res, b, corpo);

  const usuario = exigeUsuario(req);
  if (a === 'config') return rotasConfig(req, res, usuario, corpo);
  if (a && Object.hasOwn(ENTITIES, a)) return rotasEntidade(req, res, usuario, a, b, corpo, url);

  throw httpError(404, 'Rota não encontrada.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function servirArquivo(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Método não permitido.');
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const arquivo = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!arquivo.startsWith(PUBLIC_DIR + path.sep)) throw httpError(403, 'Acesso negado.');
  fs.readFile(arquivo, (err, dados) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS });
      return res.end('Página não encontrada.');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SEC_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : dados);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await rotasApi(req, res, url);
    return servirArquivo(req, res, url);
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof URIError) return send(res, 400, { erro: 'Endereço inválido.' });
    if (err.status) return send(res, err.status, { erro: err.message });
    console.error(err);
    return send(res, 500, { erro: 'Erro interno do servidor.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sistema de Cadastros rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
