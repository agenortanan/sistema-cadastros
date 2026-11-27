'use strict';

/* ------------------------------------------------------------------ *
 * Estado e utilidades
 * ------------------------------------------------------------------ */
const state = { usuario: null, schema: null, config: {} };

const $ = (sel, raiz = document) => raiz.querySelector(sel);

// Cria elementos sem usar innerHTML (evita injeção de HTML pelos dados).
function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return el;
}

async function api(metodo, caminho, corpo) {
  const opcoes = { method: metodo, credentials: 'same-origin', headers: {} };
  if (metodo === 'POST' || metodo === 'PUT') {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo ?? {});
  }
  let res;
  try {
    res = await fetch('/api' + caminho, opcoes);
  } catch {
    throw new Error('Não foi possível falar com o servidor.');
  }
  let dados = null;
  try { dados = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    if (res.status === 401 && state.usuario && !caminho.startsWith('/auth/')) {
      state.usuario = null;
      viewAuth('entrar');
      toast('Sua sessão expirou. Entre novamente.', 'erro');
    }
    const err = new Error((dados && dados.erro) || 'Algo deu errado. Tente novamente.');
    err.status = res.status;
    throw err;
  }
  return dados;
}

let toastTimer;
function toast(msg, tipo = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + (tipo === 'erro' ? 'erro' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

function aplicarTema() {
  const tema = state.config.tema;
  if (tema === 'claro' || tema === 'escuro') document.documentElement.dataset.theme = tema;
  else delete document.documentElement.dataset.theme;
}

const normOpcao = (o) => (typeof o === 'string' ? { valor: o, rotulo: o } : o);
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

function fmtDinheiro(v) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: state.config.moeda || 'BRL' }).format(v);
  } catch {
    return fmtNumero.format(v);
  }
}

function textoCampo(campo, reg) {
  if (campo.tipo === 'ref') return reg[campo.nome + '_texto'] || '';
  const v = reg[campo.nome];
  if (v == null || v === '') return '';
  if (campo.tipo === 'number') return campo.formato === 'dinheiro' ? fmtDinheiro(v) : fmtNumero.format(v);
  return String(v);
}

async function carregarConfig() {
  state.config = (await api('GET', '/config')).config;
  aplicarTema();
}

/* ------------------------------------------------------------------ *
 * Login / criar conta
 * ------------------------------------------------------------------ */
function viewAuth(modo = 'entrar') {
  const raiz = $('#app');
  raiz.replaceChildren();
  delete document.documentElement.dataset.theme;
  const criando = modo === 'criar';

  const erro = h('div', { class: 'alert', role: 'alert', hidden: true });
  const campo = (id, rotulo, props) =>
    h('div', { class: 'field' }, h('label', { for: id }, rotulo), h('input', { id, name: id, ...props }));

  const botao = h('button', { class: 'btn primary', type: 'submit' }, criando ? 'Criar conta' : 'Entrar');

  const form = h('form', { novalidate: true },
    erro,
    criando && campo('nome', 'Nome', { type: 'text', autocomplete: 'name', required: true, maxlength: 100 }),
    campo('email', 'E-mail', { type: 'email', autocomplete: 'email', required: true, maxlength: 200 }),
    campo('senha', 'Senha', {
      type: 'password', required: true, maxlength: 200,
      autocomplete: criando ? 'new-password' : 'current-password',
      ...(criando ? { minlength: 8 } : {}),
    }),
    criando && campo('confirmar', 'Confirmar senha', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 }),
    botao,
  );

  const mostrarErro = (msg) => { erro.textContent = msg; erro.hidden = false; };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const v = (id) => form.elements[id].value;
    if (criando) {
      if (v('nome').trim().length < 2) return mostrarErro('Informe seu nome.');
      if (v('senha').length < 8) return mostrarErro('A senha precisa ter pelo menos 8 caracteres.');
      if (v('senha') !== v('confirmar')) return mostrarErro('As senhas não conferem.');
    }
    if (!v('email').trim() || !v('senha')) return mostrarErro('Preencha e-mail e senha.');

    botao.disabled = true;
    try {
      const corpo = criando
        ? { nome: v('nome'), email: v('email'), senha: v('senha') }
        : { email: v('email'), senha: v('senha') };
      const r = await api('POST', criando ? '/auth/register' : '/auth/login', corpo);
      state.usuario = r.usuario;
      await carregarConfig();
      location.hash = '#/clientes';
      viewApp();
      if (criando) toast('Conta criada. Bem-vindo(a)!');
    } catch (e) {
      mostrarErro(e.message);
      botao.disabled = false;
    }
  });

  const aba = (id, rotulo) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String((id === 'criar') === criando),
    onclick: () => viewAuth(id),
  }, rotulo);

  raiz.append(h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('h1', {}, 'Sistema de Cadastros'),
      h('p', { class: 'sub' }, criando ? 'Crie sua conta para começar.' : 'Entre para acessar seus cadastros.'),
      state.schema.aviso && h('p', { class: 'aviso', role: 'note' }, state.schema.aviso),
      h('div', { class: 'tabs', role: 'tablist' }, aba('entrar', 'Entrar'), aba('criar', 'Criar conta')),
      form,
    ),
  ));
  form.elements[criando ? 'nome' : 'email'].focus();
}

async function sair() {
  try { await api('POST', '/auth/logout'); } catch { /* segue mesmo assim */ }
  state.usuario = null;
  state.config = {};
  location.hash = '';
  viewAuth('entrar');
}

/* ------------------------------------------------------------------ *
 * Estrutura do app (menu + conteúdo)
 * ------------------------------------------------------------------ */
function viewApp() {
  const raiz = $('#app');
  raiz.replaceChildren();

  const nav = h('nav', { class: 'nav', 'aria-label': 'Principal' },
    state.schema.entidades.map((e) => h('a', { href: '#/' + e.chave, 'data-rota': e.chave }, e.titulo)),
    h('div', { class: 'sep' }),
    h('a', { href: '#/configuracoes', 'data-rota': 'configuracoes' }, 'Configurações'),
  );

  raiz.append(h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand', id: 'marca' }, state.config.empresa_nome || 'Sistema de Cadastros'),
      state.schema.aviso && h('p', { class: 'aviso', role: 'note' }, state.schema.aviso),
      nav,
      h('div', { class: 'user' },
        h('span', { class: 'user-nome' }, state.usuario.nome),
        h('button', { class: 'btn ghost small', type: 'button', onclick: sair }, 'Sair'),
      ),
    ),
    h('main', { id: 'conteudo', tabindex: '-1' }),
  ));
  rota();
}

function rota() {
  if (!state.usuario) return;
  const chave = location.hash.replace(/^#\//, '') || 'clientes';
  const entidade = state.schema.entidades.find((e) => e.chave === chave);

  if (!entidade && chave !== 'configuracoes') {
    location.hash = '#/clientes';
    return;
  }
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.rota === chave) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (entidade) viewEntidade(entidade);
  else viewConfig();
}

window.addEventListener('hashchange', rota);

/* ------------------------------------------------------------------ *
 * Cadastros: lista + formulário
 * ------------------------------------------------------------------ */
function viewEntidade(ent) {
  const main = $('#conteudo');
  main.replaceChildren();
  const est = { q: '', pagina: 1, tam: 25 };

  const busca = h('input', { type: 'search', placeholder: `Buscar ${ent.titulo.toLowerCase()}…`, 'aria-label': 'Buscar', maxlength: 100 });
  const corpo = h('div', { class: 'tabela-wrap' });
  const pag = h('div', { class: 'paginacao' });

  main.append(
    h('header', { class: 'page-head' },
      h('h1', {}, ent.titulo),
      h('button', { class: 'btn primary', type: 'button', onclick: () => abrirForm(ent, null, carregar) },
        `+ Novo ${ent.singular.toLowerCase()}`),
    ),
    h('div', { class: 'toolbar' }, busca),
    corpo,
    pag,
  );

  let timer;
  busca.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { est.q = busca.value.trim(); est.pagina = 1; carregar(); }, 250);
  });

  const colunas = ent.campos.filter((f) => f.lista);

  async function carregar() {
    let r;
    try {
      const params = new URLSearchParams({ q: est.q, pagina: est.pagina, tam: est.tam });
      r = await api('GET', `/${ent.chave}?${params}`);
    } catch (e) {
      corpo.replaceChildren(h('div', { class: 'estado-vazio' }, e.message));
      return;
    }

    // caiu numa página vazia depois de excluir
    if (!r.itens.length && r.total > 0 && est.pagina > 1) {
      est.pagina -= 1;
      return carregar();
    }

    if (!r.itens.length) {
      corpo.replaceChildren(h('div', { class: 'estado-vazio' },
        est.q ? 'Nenhum resultado para a busca.' : `Nenhum ${ent.singular.toLowerCase()} cadastrado ainda.`));
      pag.replaceChildren();
      return;
    }

    const ehNum = (f) => f.tipo === 'number';
    corpo.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {},
        colunas.map((f) => h('th', { class: ehNum(f) ? 'num' : '' }, f.rotulo)),
        h('th', { class: 'acoes' }, h('span', { class: 'sr' }, 'Ações')),
      )),
      h('tbody', {}, r.itens.map((reg) => h('tr', {},
        colunas.map((f) => {
          const t = textoCampo(f, reg);
          return h('td', { class: ehNum(f) ? 'num' : '' }, t || h('span', { class: 'vazio' }, '—'));
        }),
        h('td', { class: 'acoes' },
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => abrirForm(ent, reg, carregar) }, 'Editar'),
          h('button', { class: 'btn link-danger small', type: 'button', onclick: () => excluir(reg) }, 'Excluir'),
        ),
      ))),
    ));

    const ini = (r.pagina - 1) * r.tam + 1;
    const fim = ini + r.itens.length - 1;
    const temMais = fim < r.total;
    pag.replaceChildren(
      h('span', {}, `${ini}–${fim} de ${r.total}`),
      h('div', { class: 'botoes' },
        h('button', { class: 'btn ghost small', type: 'button', disabled: r.pagina <= 1, onclick: () => { est.pagina -= 1; carregar(); } }, 'Anterior'),
        h('button', { class: 'btn ghost small', type: 'button', disabled: !temMais, onclick: () => { est.pagina += 1; carregar(); } }, 'Próxima'),
      ),
    );
  }

  async function excluir(reg) {
    const ok = await confirmar(
      `Excluir ${ent.singular.toLowerCase()}?`,
      `“${reg.nome}” será removido permanentemente. Essa ação não pode ser desfeita.`,
    );
    if (!ok) return;
    try {
      await api('DELETE', `/${ent.chave}/${reg.id}`);
      toast(`${ent.singular} excluído.`);
      carregar();
    } catch (e) {
      toast(e.message, 'erro');
    }
  }

  carregar();
}

function confirmar(titulo, texto, rotuloOk = 'Excluir') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal pequeno' },
      h('h2', {}, titulo),
      h('p', {}, texto),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close('nao') }, 'Cancelar'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => dlg.close('sim') }, rotuloOk),
      ),
    );
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'sim'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// Monta o controle de formulário para um campo da definição.
function criaControle(campo, id, valor, opcoesRef) {
  let el;
  if (campo.tipo === 'textarea') {
    el = h('textarea', { rows: 3, maxlength: 2000 });
  } else if (campo.tipo === 'select') {
    el = h('select', {}, campo.opcoes.map(normOpcao).map((o) => h('option', { value: o.valor }, o.rotulo)));
  } else if (campo.tipo === 'ref') {
    el = h('select', {},
      h('option', { value: '' }, '— Nenhum —'),
      (opcoesRef || []).map((o) => h('option', { value: String(o.id) }, o.nome)),
    );
  } else if (campo.tipo === 'number') {
    el = h('input', { type: 'number', min: 0, step: campo.formato === 'dinheiro' ? '0.01' : 'any', inputmode: 'decimal' });
  } else {
    el = h('input', { type: campo.tipo === 'email' ? 'email' : 'text', maxlength: 200, autocomplete: 'off' });
  }
  el.id = id;
  el.name = campo.nome;
  if (campo.obrigatorio) el.required = true;
  if (valor != null) el.value = String(valor); // depois das <option>, para selects
  return el;
}

async function abrirForm(ent, reg, aoSalvar) {
  const opcoesRef = {};
  for (const f of ent.campos.filter((c) => c.tipo === 'ref')) {
    try { opcoesRef[f.nome] = (await api('GET', `/${f.ref}/opcoes`)).itens; } catch { opcoesRef[f.nome] = []; }
  }

  const erro = h('div', { class: 'alert', role: 'alert', hidden: true });
  const controles = {};
  const blocos = ent.campos.map((f) => {
    const id = `f-${f.nome}`;
    controles[f.nome] = criaControle(f, id, reg ? reg[f.nome] : null, opcoesRef[f.nome]);
    return h('div', { class: 'field' },
      h('label', { for: id }, f.rotulo, f.obrigatorio && h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
      controles[f.nome],
    );
  });

  const salvar = h('button', { class: 'btn primary', type: 'submit' }, 'Salvar');
  const titulo = reg ? `Editar ${ent.singular.toLowerCase()}` : `Novo ${ent.singular.toLowerCase()}`;
  const dlg = h('dialog', { class: 'modal', 'aria-label': titulo });
  const form = h('form', { method: 'dialog' },
    h('h2', {}, titulo),
    erro,
    blocos,
    h('div', { class: 'acoes' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
      salvar,
    ),
  );
  dlg.append(form);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    if (!form.reportValidity()) return;
    const dados = {};
    for (const f of ent.campos) dados[f.nome] = controles[f.nome].value;
    salvar.disabled = true;
    try {
      if (reg) await api('PUT', `/${ent.chave}/${reg.id}`, dados);
      else await api('POST', `/${ent.chave}`, dados);
      dlg.close();
      toast(reg ? 'Alterações salvas.' : `${ent.singular} cadastrado.`);
      aoSalvar();
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
      salvar.disabled = false;
    }
  });

  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  const primeiro = form.querySelector('input, select, textarea');
  if (primeiro) primeiro.focus();
}

/* ------------------------------------------------------------------ *
 * Configurações
 * ------------------------------------------------------------------ */
function viewConfig() {
  const main = $('#conteudo');
  main.replaceChildren(h('header', { class: 'page-head' }, h('h1', {}, 'Configurações')));

  const secaoConfig = (grupo, titulo, descricao) => {
    const campos = state.schema.config.filter((c) => c.grupo === grupo);
    const erro = h('div', { class: 'alert', role: 'alert', hidden: true });
    const controles = {};
    const blocos = campos.map((f) => {
      const id = `cfg-${f.nome}`;
      const el = criaControle(f, id, state.config[f.nome], null);
      controles[f.nome] = el;
      return h('div', { class: 'field' + (f.nome === 'empresa_endereco' || f.nome === 'empresa_nome' ? ' cheio' : '') },
        h('label', { for: id }, f.rotulo), el);
    });
    const botao = h('button', { class: 'btn primary', type: 'submit' }, 'Salvar');
    const form = h('form', { novalidate: true }, erro, h('div', { class: 'grade' }, blocos), botao);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erro.hidden = true;
      botao.disabled = true;
      const dados = {};
      for (const f of campos) dados[f.nome] = controles[f.nome].value;
      try {
        state.config = (await api('PUT', '/config', dados)).config;
        aplicarTema();
        const marca = $('#marca');
        if (marca) marca.textContent = state.config.empresa_nome || 'Sistema de Cadastros';
        toast('Configurações salvas.');
      } catch (e) {
        erro.textContent = e.message;
        erro.hidden = false;
      }
      botao.disabled = false;
    });
    return h('section', { class: 'card' }, h('h2', {}, titulo), h('p', { class: 'desc' }, descricao), form);
  };

  // Alterar senha
  const erroSenha = h('div', { class: 'alert', role: 'alert', hidden: true });
  const campoSenha = (id, rotulo, auto) =>
    h('div', { class: 'field' }, h('label', { for: id }, rotulo),
      h('input', { id, name: id, type: 'password', autocomplete: auto, required: true, maxlength: 200 }));
  const botaoSenha = h('button', { class: 'btn primary', type: 'submit' }, 'Alterar senha');
  const formSenha = h('form', { novalidate: true },
    erroSenha,
    campoSenha('atual', 'Senha atual', 'current-password'),
    campoSenha('nova', 'Nova senha (mínimo 8 caracteres)', 'new-password'),
    campoSenha('confirmar', 'Confirmar nova senha', 'new-password'),
    botaoSenha,
  );
  formSenha.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroSenha.hidden = true;
    const v = (id) => formSenha.elements[id].value;
    if (v('nova').length < 8) { erroSenha.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.'; erroSenha.hidden = false; return; }
    if (v('nova') !== v('confirmar')) { erroSenha.textContent = 'As senhas não conferem.'; erroSenha.hidden = false; return; }
    botaoSenha.disabled = true;
    try {
      await api('POST', '/auth/senha', { atual: v('atual'), nova: v('nova') });
      formSenha.reset();
      toast('Senha alterada.');
    } catch (e) {
      erroSenha.textContent = e.message;
      erroSenha.hidden = false;
    }
    botaoSenha.disabled = false;
  });

  main.append(
    secaoConfig('empresa', 'Dados da empresa', 'Informações básicas da sua empresa.'),
    secaoConfig('preferencias', 'Preferências', 'Moeda usada nos valores e aparência do sistema.'),
    h('section', { class: 'card' },
      h('h2', {}, 'Segurança'),
      h('p', { class: 'desc' }, `Conta: ${state.usuario.email}. Ao alterar a senha, os outros acessos desta conta são encerrados.`),
      formSenha,
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Início
 * ------------------------------------------------------------------ */
(async function iniciar() {
  try {
    state.schema = await api('GET', '/schema');
  } catch {
    $('#app').textContent = 'Não foi possível carregar o sistema. Verifique se o servidor está ligado.';
    return;
  }
  try {
    state.usuario = (await api('GET', '/auth/me')).usuario;
    if (state.usuario) await carregarConfig();
  } catch {
    state.usuario = null;
  }
  if (state.usuario) viewApp();
  else viewAuth('entrar');
})();
