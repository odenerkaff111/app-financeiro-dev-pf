import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, customRequire = require) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  const errors = compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
  assert.equal(errors.length, 0, 'Erro ao compilar ' + file);
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: customRequire, Intl, Date, Set, Math, Number, Error });
  return module.exports;
}

const summary = load('src/lib/dashboard/summary.ts');
const { BankBalanceOverview } = load('src/components/dashboard/BankBalanceOverview.tsx', name =>
  name === '@/lib/dashboard/summary' ? summary : require(name));
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('OK ' + name); };
const account = (id, type, balance, extra = {}) => ({ id, name: id, type, balance, is_active: true, ...extra });
const example = [
  account('Santander', 'checking', '130.04'),
  account('Nubank', 'checking', '38.01'),
  account('Itaú', 'checking', '28.64'),
  account('C6', 'checking', 0, { account_scope: 'business' }),
  account('Em espécie', 'cash', 0),
  account('Nubank crédito', 'credit_card', 29.90, { available_credit: '198.16' }),
  account('Vanda - Cartao emprestado (controle)', 'credit_card', 0, { available_credit: 8000 }),
  account('Caixinha', 'investment', 300),
];
const render = accounts => renderToStaticMarkup(React.createElement(BankBalanceOverview, { balances: summary.summarizeBalances(accounts) }));

test('Caso informado: R$ 196,69 em contas + R$ 198,16 de crédito = R$ 394,85', () => {
  const balances = summary.summarizeBalances(example);
  assert.equal(balances.cash, 196.69);
  assert.equal(balances.credit, 198.16);
  assert.equal(balances.spendingPower, 394.85);
  assert.equal(balances.invested, 300);
  assert.equal(balances.unknownCredit, 0);
});
test('Crédito de terceiros não aumenta o total mesmo com limite preenchido', () => {
  const s = summary.summarizeBalances(example.slice(6, 7));
  assert.equal(s.credit, 0);
  assert.equal(s.spendingPower, 0);
  assert.equal(s.unknownCredit, 0);
});
test('Terceiro sem limite não torna o total próprio parcial', () => {
  assert.equal(summary.summarizeBalances([account('Cartão de terceiro', 'credit_card', 0)]).unknownCredit, 0);
});
test('Usa limite disponível e não saldo da fatura ou limite contratado', () => {
  const s = summary.summarizeBalances([account('Meu cartão', 'credit_card', 900, { available_credit: 25, credit_limit: 1000 })]);
  assert.equal(s.spendingPower, 25);
});
test('Crédito desconhecido não é estimado; total conhecido permanece parcial', () => {
  const a = [account('Banco', 'checking', 10), account('Cartão', 'credit_card', 99)];
  assert.equal(summary.summarizeBalances(a).spendingPower, 10);
  assert.match(render(a), /Total parcial:/);
  assert.match(render(a), /Não informado/);
});
test('Crédito conhecido e desconhecido preservam apenas a parcela informada', () => {
  const s = summary.summarizeBalances([account('A', 'credit_card', 0, { available_credit: 12.34 }), account('B', 'credit_card', 0)]);
  assert.equal(s.spendingPower, 12.34);
  assert.equal(s.unknownCredit, 1);
});
test('Contas inativas e reservas não financiam disponível para compras', () => {
  const s = summary.summarizeBalances([account('Banco', 'checking', 50), account('Inativa', 'credit_card', 0, { available_credit: 800, is_active: false }), account('Reserva', 'investment', 1000)]);
  assert.equal(s.spendingPower, 50);
  assert.equal(s.invested, 1000);
});
test('Centavos exatos entre bancos e vários cartões', () => {
  const s = summary.summarizeBalances([account('A', 'checking', '0.10'), account('B', 'credit_card', 0, { available_credit: '0.20' }), account('C', 'credit_card', 0, { available_credit: '0.30' })]);
  assert.equal(s.spendingPower, 0.60);
});
test('Conta negativa é preservada; limite negativo não é poder de compra', () => {
  const s = summary.summarizeBalances([account('Banco', 'checking', -50), account('Cartão A', 'credit_card', 0, { available_credit: 100 }), account('Cartão B', 'credit_card', 0, { available_credit: -20 })]);
  assert.equal(s.cash, -50);
  assert.equal(s.credit, 100);
  assert.equal(s.spendingPower, 50);
});
test('Sem cartões: total é só dinheiro e crédito informado é zero', () => {
  const html = render([account('Banco', 'checking', 42)]);
  assert.equal(summary.summarizeBalances([account('Banco', 'checking', 42)]).spendingPower, 42);
  assert.doesNotMatch(html, /Não informado|Total parcial/);
});
test('Renderização real destaca R$ 394,85 e mantém os três componentes separados', () => {
  const html = render(example);
  assert.match(html, /Disponível para compras/);
  assert.match(html, /394,85/);
  assert.match(html, /196,69/);
  assert.match(html, /198,16/);
  assert.match(html, /300,00/);
  assert.match(html, /Saldo consolidado em contas/);
  assert.match(html, /Usar crédito gera uma fatura a pagar/);
  assert.doesNotMatch(html, /NaN|8\.000,00|Total parcial/);
});
test('Apenas crédito: card principal exibe capacidade sem fabricar saldo bancário', () => {
  const s = summary.summarizeBalances([account('Cartão', 'credit_card', 0, { available_credit: 198.16 })]);
  assert.equal(s.cash, 0);
  assert.equal(s.spendingPower, 198.16);
});

console.log(`\n${count} testes de disponibilidade aprovados.`);
