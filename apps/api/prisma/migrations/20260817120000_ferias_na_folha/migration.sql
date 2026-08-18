-- Ferias dentro da folha.
--
-- Quem entra de ferias nao recebe salario naquele mes: recebe o valor das
-- ferias, que a contabilidade apura e que nao tem relacao com o saldo salarial
-- daqui (comissao, hora extra, vale). Ate agora isso era feito trocando o valor
-- do salario na mao, e o pagamento ficava gravado como SALARIO -- o relatorio
-- do IXC, a dashboard e o proprio historico da pessoa diziam "salario" para um
-- dinheiro que era de ferias.
--
-- Daqui em diante o lancamento tem tipo proprio, conta contabil propria e
-- observacao propria. E ele que faz a pessoa sair desmarcada da folha do dia
-- 25: de ferias, ninguem adianta salario.
ALTER TYPE "TipoLancamento" ADD VALUE 'FERIAS';

-- Nasce igual a de salario: a contabilidade pode ou nao querer conta separada,
-- e ate alguem dizer o contrario o dinheiro continua caindo onde sempre caiu.
ALTER TABLE "config_financeira"
  ADD COLUMN "conta_contabil_ferias" INTEGER NOT NULL DEFAULT 2420,
  ADD COLUMN "obs_ferias_template" TEXT NOT NULL DEFAULT 'férias referentes ao mês {competencia}';
