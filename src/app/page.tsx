"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  AlertCircle,
  Clock,
  Receipt,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import {
  format,
  isAfter,
  isSameMonth,
  isSameWeek,
  isToday,
  parseISO,
  addMonths,
} from "date-fns";

export default function DashboardPage() {
  const [montado, setMontado] = useState(false);
  const [transacoes, setTransacoes] = useState<any[]>([]);
  const [clientesBase, setClientesBase] = useState<any[]>([]);
  const [filtroPeriodo, setFiltroPeriodo] = useState("mes");
  const [userName, setUserName] = useState("Sócio");
  const [taxaImposto, setTaxaImposto] = useState(0.155);
  const [contaSelecionada, setContaSelecionada] = useState<any>(null);

  const mockTransacoes = [
    {
      id: "m1",
      tipo: "receita",
      valor: 5800,
      status: "Pago",
      categoria: "Serviços",
      nome: "Cliente A",
      descricao: "Projeto mensal",
      data_competencia: "2026-07-01",
      data_pagamento: "2026-07-01",
      data_vencimento: "2026-07-05",
    },
    {
      id: "m2",
      tipo: "despesa",
      valor: 1420,
      status: "Pago",
      categoria: "Despesas",
      nome: "Fornecedor",
      descricao: "Conta de internet",
      data_competencia: "2026-07-03",
      data_pagamento: "2026-07-03",
      data_vencimento: "2026-07-03",
    },
    {
      id: "m3",
      tipo: "receita",
      valor: 3200,
      status: "Pendente",
      categoria: "Serviços",
      nome: "Cliente B",
      descricao: "Prestação de serviço",
      data_competencia: "2026-07-09",
      data_pagamento: null,
      data_vencimento: "2026-07-15",
    },
    {
      id: "m4",
      tipo: "despesa",
      valor: 890,
      status: "Pendente",
      categoria: "Diversão",
      nome: "Ads",
      descricao: "Campanha",
      data_competencia: "2026-07-10",
      data_pagamento: null,
      data_vencimento: "2026-07-20",
    },
    {
      id: "m5",
      tipo: "receita",
      valor: 1800,
      status: "Recebido",
      categoria: "Serviços",
      nome: "Cliente C",
      descricao: "Reembolso",
      data_competencia: "2026-06-22",
      data_pagamento: "2026-06-22",
      data_vencimento: "2026-06-22",
    },
    {
      id: "m6",
      tipo: "despesa",
      valor: 560,
      status: "Pago",
      categoria: "Educação",
      nome: "Estado",
      descricao: "ISS",
      data_competencia: "2026-06-18",
      data_pagamento: "2026-06-18",
      data_vencimento: "2026-06-18",
    },
    {
      id: "m7",
      tipo: "despesa",
      valor: 780,
      status: "Pendente",
      categoria: "Empréstimo",
      nome: "Banco",
      descricao: "Parcela",
      data_competencia: "2026-07-12",
      data_pagamento: null,
      data_vencimento: "2026-07-25",
    },
    {
      id: "m8",
      tipo: "despesa",
      valor: 320,
      status: "Pago",
      categoria: "Alimentação",
      nome: "Super",
      descricao: "Compras do mês",
      data_competencia: "2026-07-04",
      data_pagamento: "2026-07-04",
      data_vencimento: "2026-07-04",
    },
    {
      id: "m9",
      tipo: "despesa",
      valor: 950,
      status: "Pago",
      categoria: "Investimento",
      nome: "Renda fixa",
      descricao: "Aplicação",
      data_competencia: "2026-07-06",
      data_pagamento: "2026-07-06",
      data_vencimento: "2026-07-06",
    },
    {
      id: "m10",
      tipo: "despesa",
      valor: 410,
      status: "Pendente",
      categoria: "Dívidas",
      nome: "Cartão",
      descricao: "Fatura",
      data_competencia: "2026-07-14",
      data_pagamento: null,
      data_vencimento: "2026-07-28",
    },
  ];

  const mockClientes = [
    {
      id: "c1",
      status: "Ativo",
    },
    {
      id: "c2",
      status: "Ativo",
    },
    {
      id: "c3",
      status: "Inativo",
    },
  ];

  useEffect(() => {
    setMontado(true);
    carregarDados();
  }, []);

  async function carregarDados() {
    const [
      resTransacoes,
      resClientes,
      resSession,
      resConfig,
    ] = await Promise.all([
      supabase.from("transacoes").select("*"),
      supabase.from("clientes").select("id, status"),
      supabase.auth.getSession(),
      supabase
        .from("configuracoes_sistema")
        .select("imposto_simples_nacional_percentual")
        .eq("id", 1)
        .single(),
    ]);

    const transacoesCarregadas =
      resTransacoes.data && resTransacoes.data.length > 0
        ? resTransacoes.data
        : mockTransacoes;

    const clientesCarregados =
      resClientes.data && resClientes.data.length > 0
        ? resClientes.data
        : mockClientes;

    setTransacoes(transacoesCarregadas as any[]);
    setClientesBase(clientesCarregados as any[]);

    if (resConfig.data) {
      setTaxaImposto(
        Number(
          resConfig.data.imposto_simples_nacional_percentual,
        ) / 100,
      );
    }

    let nomeReal = "Sócio";

    if (resSession.data.session) {
      const { data: perfil } = await supabase
        .from("perfis")
        .select("nome")
        .eq("id", resSession.data.session.user.id)
        .single();

      if (perfil?.nome) {
        nomeReal = perfil.nome.split(" ")[0];
        setUserName(nomeReal);
      }
    }

    if ("speechSynthesis" in window) {
      const agora = Date.now();
      const ultimo = localStorage.getItem("jarvis_last_speak");
      const quatroHoras = 1000 * 60 * 60 * 4;

      if (
        !ultimo ||
        agora - parseInt(ultimo, 10) > quatroHoras
      ) {
        const msg = new SpeechSynthesisUtterance(
          `Bem-vindo de volta, ${nomeReal}. Este é seu resumo financeiro!`,
        );

        msg.lang = "pt-BR";
        msg.rate = 1.0;

        window.speechSynthesis.speak(msg);

        localStorage.setItem(
          "jarvis_last_speak",
          agora.toString(),
        );
      }
    }
  }

  const getSafeDate = (dateStr: any) => {
    try {
      return dateStr ? parseISO(dateStr) : new Date();
    } catch {
      return new Date();
    }
  };

  const hoje = new Date();
  const proximoMes = addMonths(hoje, 1);

  const dadosFiltrados = transacoes.filter((transacao) => {
    if (filtroPeriodo === "tudo") {
      return true;
    }

    const dataRef = getSafeDate(
      transacao.data_competencia,
    );

    if (filtroPeriodo === "hoje") {
      return isToday(dataRef);
    }

    if (filtroPeriodo === "semana") {
      return isSameWeek(dataRef, hoje);
    }

    if (filtroPeriodo === "mes") {
      return isSameMonth(dataRef, hoje);
    }

    return true;
  });

  let entrada = 0;
  let saida = 0;
  let pagamentosEmDia = 0;
  let pagamentosAtrasados = 0;
  let aReceberProximoMes = 0;

  const despesasPorCategoria: Record<string, number> = {};
  const graficoMap: Record<string, any> = {};

  const meses = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ];

  const lembretes = transacoes
    .filter(
      (transacao) =>
        transacao.status?.toLowerCase() === "pendente",
    )
    .sort(
      (a, b) =>
        getSafeDate(a.data_vencimento).getTime() -
        getSafeDate(b.data_vencimento).getTime(),
    )
    .slice(0, 5);

  dadosFiltrados.forEach((transacao) => {
    const valor = Number(transacao.valor) || 0;

    const statusPago =
      transacao.status?.toLowerCase() === "pago" ||
      transacao.status?.toLowerCase() === "recebido";

    if (statusPago) {
      if (transacao.tipo === "receita") {
        entrada += valor;
      }

      if (transacao.tipo === "despesa") {
        saida += valor;

        const categoria =
          transacao.categoria || "Despesas";

        despesasPorCategoria[categoria] =
          (despesasPorCategoria[categoria] || 0) +
          valor;
      }

      const dataPagamentoReal =
        transacao.data_pagamento ||
        transacao.data_competencia;

      const mesIdx =
        getSafeDate(dataPagamentoReal).getMonth();

      const nomeMes = meses[mesIdx];

      if (!graficoMap[nomeMes]) {
        graficoMap[nomeMes] = {
          name: nomeMes,
          Entrada: 0,
          Saida: 0,
        };
      }

      if (transacao.tipo === "receita") {
        graficoMap[nomeMes].Entrada += valor;
      }

      if (transacao.tipo === "despesa") {
        graficoMap[nomeMes].Saida += valor;
      }
    }

    if (transacao.tipo === "receita") {
      if (statusPago) {
        pagamentosEmDia++;
      }

      const statusPendenteOuAtrasado =
        transacao.status?.toLowerCase() ===
          "pendente" ||
        transacao.status?.toLowerCase() ===
          "atrasado";

      if (
        statusPendenteOuAtrasado &&
        isAfter(
          hoje,
          getSafeDate(transacao.data_vencimento),
        )
      ) {
        pagamentosAtrasados++;
      }
    }
  });

  transacoes.forEach((transacao) => {
    if (
      transacao.tipo === "receita" &&
      transacao.status?.toLowerCase() === "pendente"
    ) {
      if (
        isSameMonth(
          getSafeDate(transacao.data_vencimento),
          proximoMes,
        )
      ) {
        aReceberProximoMes +=
          Number(transacao.valor) || 0;
      }
    }
  });

  const saldo = entrada - saida;

  const margemLucro =
    entrada > 0
      ? ((entrada - saida) / entrada) * 100
      : 0;

  const categoriasObjetivo = [
    "alimentação",
    "empréstimo",
    "dívidas",
    "despesas",
    "investimento",
    "educação",
    "diversão",
  ];

  const gastosPorCategoria =
    categoriasObjetivo.reduce(
      (acc, categoria) => ({
        ...acc,
        [categoria]: 0,
      }),
      {} as Record<string, number>,
    );

  transacoes.forEach((transacao) => {
    if (transacao.tipo !== "despesa") {
      return;
    }

    const categoriaNormalizada = String(
      transacao.categoria || "",
    )
      .trim()
      .toLowerCase();

    const mapaCategoria = {
      alimentação: "alimentação",
      alimento: "alimentação",
      comida: "alimentação",
      emprestimo: "empréstimo",
      empréstimo: "empréstimo",
      divida: "dívidas",
      dívida: "dívidas",
      dividas: "dívidas",
      despesa: "despesas",
      despesas: "despesas",
      investimento: "investimento",
      investir: "investimento",
      educação: "educação",
      educacao: "educação",
      curso: "educação",
      diversao: "diversão",
      lazer: "diversão",
      entretenimento: "diversão",
    } as Record<string, string>;

    const categoriaFinal =
      mapaCategoria[categoriaNormalizada] ||
      "despesas";

    gastosPorCategoria[categoriaFinal] =
      (gastosPorCategoria[categoriaFinal] || 0) +
      Number(transacao.valor || 0);
  });

  const dadosGastosCategorias = categoriasObjetivo
    .map((categoria) => ({
      name: categoria,
      value: gastosPorCategoria[categoria] || 0,
    }))
    .filter((categoria) => categoria.value > 0);

  const dadosPerformance = meses.map(
    (mes) =>
      graficoMap[mes] || {
        name: mes,
        Entrada: 0,
        Saida: 0,
      },
  );

  const CORES_PIE = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
  ];

  const dadosCategorias = Object.keys(
    despesasPorCategoria,
  )
    .map((categoria) => ({
      name: categoria,
      value: despesasPorCategoria[categoria],
    }))
    .filter((categoria) => categoria.value > 0)
    .sort((a, b) => b.value - a.value);

  const formatarMoeda = (valor: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(valor);

  const formatarEixoY = (valor: number) =>
    new Intl.NumberFormat("pt-BR", {
      notation: "compact",
      compactDisplay: "short",
    }).format(valor);

  const abrirConta = (conta: any) => {
    setContaSelecionada(conta);
  };

  const fecharConta = () => {
    setContaSelecionada(null);
  };

  const alternarStatusConta = (
    id: string,
    novoStatus: string,
  ) => {
    setTransacoes((transacoesAtuais) =>
      transacoesAtuais.map((item) =>
        item.id === id
          ? {
              ...item,
              status: novoStatus,
            }
          : item,
      ),
    );

    setContaSelecionada((contaAtual: any) =>
      contaAtual
        ? {
            ...contaAtual,
            status: novoStatus,
          }
        : contaAtual,
    );
  };

  if (!montado) {
    return null;
  }

  const cardEstilo =
    "bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col";

  const periodos = [
    {
      value: "hoje",
      label: "Hoje",
    },
    {
      value: "semana",
      label: "Semana",
    },
    {
      value: "mes",
      label: "Este mês",
    },
    {
      value: "tudo",
      label: "Todo período",
    },
  ];

  return (
    <div className="space-y-6 pb-10 font-sans">
      <div className="flex justify-center">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-[#0D1B2A]/10 bg-white/80 p-1.5 shadow-sm backdrop-blur">
          {periodos.map((periodo) => {
            const ativo =
              filtroPeriodo === periodo.value;

            return (
              <button
                key={periodo.value}
                type="button"
                onClick={() =>
                  setFiltroPeriodo(periodo.value)
                }
                aria-pressed={ativo}
                className={[
                  "shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                  ativo
                    ? "bg-[#0D1B2A] text-[#F7F5EF] shadow-md"
                    : "text-[#3A3A3C]/70 hover:bg-[#C8A15A]/10 hover:text-[#0D1B2A]",
                ].join(" ")}
              >
                {periodo.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className={cardEstilo}>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">
              Entradas
            </span>

            <ArrowUpCircle
              className="text-green-500"
              size={20}
            />
          </div>

          <h3 className="text-3xl font-semibold tracking-tight text-gray-900">
            {formatarMoeda(entrada)}
          </h3>
        </div>

        <div className={cardEstilo}>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">
              Saídas
            </span>

            <ArrowDownCircle
              className="text-red-500"
              size={20}
            />
          </div>

          <h3 className="text-3xl font-semibold tracking-tight text-gray-900">
            {formatarMoeda(saida)}
          </h3>
        </div>

        <div className={cardEstilo}>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">
              Caixa
            </span>

            <Wallet
              className="text-blue-600"
              size={20}
            />
          </div>

          <h3
            className={[
              "text-3xl font-semibold tracking-tight",
              saldo >= 0
                ? "text-gray-900"
                : "text-red-600",
            ].join(" ")}
          >
            {formatarMoeda(saldo)}
          </h3>
        </div>

        <div
          className={`${cardEstilo} border-emerald-200 bg-emerald-50`}
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-700">
              A receber (Mês seguinte)
            </span>

            <Receipt
              className="text-emerald-600"
              size={20}
            />
          </div>

          <h3 className="text-3xl font-semibold tracking-tight text-emerald-900 tabular-nums">
            {formatarMoeda(aReceberProximoMes)}
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div
          className={`${cardEstilo} xl:col-span-2`}
        >
          <h2 className="mb-6 text-base font-semibold text-gray-900">
            Fluxo de Caixa Mensal
          </h2>

          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <BarChart
                data={dadosPerformance}
                margin={{
                  top: 10,
                  right: 10,
                  left: 10,
                  bottom: 0,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e5e7eb"
                />

                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#6b7280",
                    fontSize: 12,
                  }}
                  dy={10}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#6b7280",
                    fontSize: 12,
                  }}
                  tickFormatter={formatarEixoY}
                />

                <RechartsTooltip
                  cursor={{
                    fill: "#f3f4f6",
                  }}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                    boxShadow:
                      "0 4px 12px rgba(0,0,0,0.05)",
                    fontSize: "13px",
                  }}
                />

                <Bar
                  dataKey="Entrada"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  barSize={16}
                />

                <Bar
                  dataKey="Saida"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                  barSize={16}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={cardEstilo}>
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            Distribuição de Gastos
          </h2>

          {dadosGastosCategorias.length > 0 ? (
            <div className="mt-4 flex flex-1 flex-col items-center justify-center">
              <div className="h-48 w-full min-w-0">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <PieChart>
                    <Pie
                      data={dadosGastosCategorias}
                      innerRadius={55}
                      outerRadius={75}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {dadosGastosCategorias.map(
                        (_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              CORES_PIE[
                                index %
                                  CORES_PIE.length
                              ]
                            }
                          />
                        ),
                      )}
                    </Pie>

                    <RechartsTooltip
                      formatter={(value: any) =>
                        formatarMoeda(Number(value))
                      }
                      contentStyle={{
                        borderRadius: "8px",
                        border: "none",
                        boxShadow:
                          "0 4px 12px rgba(0,0,0,0.08)",
                        fontSize: "13px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-6 w-full space-y-3">
                {dadosGastosCategorias.map(
                  (categoria, index) => {
                    const totalGasto = Object.values(
                      gastosPorCategoria,
                    ).reduce(
                      (acc, valorAtual) =>
                        acc + valorAtual,
                      0,
                    );

                    const porcentagem =
                      totalGasto > 0
                        ? (
                            (categoria.value /
                              totalGasto) *
                            100
                          ).toFixed(1)
                        : "0.0";

                    return (
                      <div
                        key={`${categoria.name}-${index}`}
                        className="flex justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                CORES_PIE[
                                  index %
                                    CORES_PIE.length
                                ],
                            }}
                          />

                          <span className="capitalize text-gray-600">
                            {categoria.name}
                          </span>
                        </div>

                        <span className="font-medium text-gray-900">
                          {porcentagem}%
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              Dados insuficientes.
            </div>
          )}
        </div>
      </div>

      <div
        className={`${cardEstilo} justify-start`}
      >
        <div className="mb-6 flex items-center gap-2">
          <AlertCircle
            className="text-gray-500"
            size={18}
            strokeWidth={2.5}
          />

          <h2 className="text-base font-semibold text-gray-900">
            Contas Pendentes
          </h2>
        </div>

        <div className="space-y-3">
          {lembretes.length > 0 ? (
            lembretes.map((lembrete) => {
              const vencido = isAfter(
                hoje,
                getSafeDate(
                  lembrete.data_vencimento,
                ),
              );

              return (
                <button
                  type="button"
                  onClick={() =>
                    abrirConta(lembrete)
                  }
                  key={lembrete.id}
                  className="group flex w-full cursor-pointer items-center justify-between rounded-lg border border-gray-200 p-3.5 text-left transition-all hover:border-blue-300 hover:bg-blue-50"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={[
                        "h-2 w-2 rounded-full",
                        vencido
                          ? "bg-red-500"
                          : "bg-amber-400",
                      ].join(" ")}
                    />

                    <div>
                      <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700">
                        {lembrete.nome ||
                          lembrete.descricao}
                      </p>

                      <div className="mt-0.5 flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-500">
                        <Clock size={10} />

                        <span>
                          Vencimento:{" "}
                          {format(
                            getSafeDate(
                              lembrete.data_vencimento,
                            ),
                            "dd/MM/yyyy",
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatarMoeda(
                          lembrete.valor,
                        )}
                      </p>

                      {vencido ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">
                          Atrasado
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                          Aguardando
                        </span>
                      )}
                    </div>

                    <Wallet
                      size={16}
                      className="text-gray-400 group-hover:text-blue-600"
                    />
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-6 text-center text-sm text-gray-400">
              Sem pendências registradas.
            </div>
          )}
        </div>
      </div>

      {contaSelecionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {contaSelecionada.nome ||
                    contaSelecionada.descricao}
                </h3>

                <p className="mt-1 text-sm text-gray-600">
                  {contaSelecionada.descricao ||
                    "Detalhes da conta pendente"}
                </p>
              </div>

              <button
                type="button"
                onClick={fecharConta}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Fechar detalhes"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 space-y-3 text-sm text-gray-700">
              <div className="flex justify-between">
                <span className="text-gray-500">
                  Valor
                </span>

                <span className="font-semibold text-gray-900">
                  {formatarMoeda(
                    Number(
                      contaSelecionada.valor || 0,
                    ),
                  )}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">
                  Vencimento
                </span>

                <span className="font-semibold text-gray-900">
                  {format(
                    getSafeDate(
                      contaSelecionada.data_vencimento,
                    ),
                    "dd/MM/yyyy",
                  )}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">
                  Categoria
                </span>

                <span className="font-semibold text-gray-900">
                  {contaSelecionada.categoria ||
                    "Sem categoria"}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">
                  Status
                </span>

                <span
                  className={[
                    "font-semibold",
                    contaSelecionada.status?.toLowerCase() ===
                      "pago" ||
                    contaSelecionada.status?.toLowerCase() ===
                      "recebido"
                      ? "text-emerald-600"
                      : "text-amber-600",
                  ].join(" ")}
                >
                  {contaSelecionada.status ||
                    "Pendente"}
                </span>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() =>
                  alternarStatusConta(
                    contaSelecionada.id,
                    contaSelecionada.status?.toLowerCase() ===
                      "pago" ||
                      contaSelecionada.status?.toLowerCase() ===
                        "recebido"
                      ? "Pendente"
                      : "Pago",
                  )
                }
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                {contaSelecionada.status?.toLowerCase() ===
                  "pago" ||
                contaSelecionada.status?.toLowerCase() ===
                  "recebido"
                  ? "Marcar como pendente"
                  : "Marcar como pago"}
              </button>

              <button
                type="button"
                onClick={fecharConta}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}