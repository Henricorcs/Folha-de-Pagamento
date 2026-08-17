import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { MODULO_CONTAS_PAGAR, MODULO_FOLHA } from './lib/modulos';
import { Assinar } from './pages/Assinar';
import { Login } from './pages/Login';
import { Modulos } from './pages/Modulos';
import { Inicio as ContasPagarInicio } from './pages/contas-pagar/Inicio';
import { Categorias as ContasPagarCategorias } from './pages/contas-pagar/Categorias';
import { Dashboard as ContasPagarDashboard } from './pages/contas-pagar/Dashboard';
import { HistoricoDePagamentos } from './pages/contas-pagar/HistoricoDePagamentos';
import { Recorrentes } from './pages/contas-pagar/Recorrentes';
import { Avulsos } from './pages/folha/Avulsos';
import { Configuracoes } from './pages/folha/Configuracoes';
import { ContasPagar } from './pages/folha/ContasPagar';
import { Dashboard } from './pages/folha/Dashboard';
import { Diaristas } from './pages/folha/Diaristas';
import { Ferias } from './pages/folha/Ferias';
import { Folha } from './pages/folha/Folha';
import { FuncionarioDetalhe } from './pages/folha/FuncionarioDetalhe';
import { Funcionarios } from './pages/folha/Funcionarios';
import { Impostos } from './pages/folha/Impostos';
import { MinhaConta } from './pages/folha/MinhaConta';
import { Usuarios } from './pages/folha/Usuarios';
import { Vales } from './pages/folha/Vales';
import type { ReactNode } from 'react';

function Protegida({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth();
  if (carregando) {
    return (
      <div className="flex h-screen items-center justify-center bg-tinta-50 text-tinta-500">
        Carregando…
      </div>
    );
  }
  return usuario ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Gerenciar logins é só do administrador. A API já barra, mas esconder a tela
 * evita a frustração de abrir e levar erro.
 */
function SomenteAdmin({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  return usuario?.role === 'ADMIN' ? (
    <>{children}</>
  ) : (
    <Navigate to="/folha/dashboard" replace />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Quem recebeu o dinheiro assina aqui. Fora do login de propósito: o
          diarista não tem conta no sistema, e o link é a credencial dele. */}
      <Route path="/assinar/:token" element={<Assinar />} />
      <Route
        path="/modulos"
        element={
          <Protegida>
            <Modulos />
          </Protegida>
        }
      />

      <Route
        path="/folha"
        element={
          <Protegida>
            <Layout modulo={MODULO_FOLHA} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="funcionarios" element={<Funcionarios />} />
        <Route path="funcionarios/:id" element={<FuncionarioDetalhe />} />
        <Route path="diaristas" element={<Diaristas />} />
        <Route path="vales" element={<Vales />} />
        <Route path="ferias" element={<Ferias />} />
        <Route path="gerar-folha" element={<Folha />} />
        <Route path="pagamentos" element={<ContasPagar />} />
        <Route path="avulsos" element={<Avulsos />} />
        <Route path="impostos" element={<Impostos />} />
        <Route path="configuracoes" element={<Configuracoes />} />
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route
          path="usuarios"
          element={
            <SomenteAdmin>
              <Usuarios />
            </SomenteAdmin>
          }
        />
      </Route>

      <Route
        path="/contas-pagar"
        element={
          <Protegida>
            <Layout modulo={MODULO_CONTAS_PAGAR} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="inicio" replace />} />
        <Route path="inicio" element={<ContasPagarInicio />} />
        {/* A outra metade da mesma tabela do IXC: o que já saiu. */}
        <Route path="pagos" element={<HistoricoDePagamentos />} />
        <Route path="dashboard" element={<ContasPagarDashboard />} />
        {/* O caminho antigo continua valendo: quem tem a tela no favorito ou
            aberta numa aba não pode cair num "não encontrado" por causa de uma
            troca de nome nossa. */}
        <Route
          path="painel"
          element={<Navigate to="/contas-pagar/dashboard" replace />}
        />
        {/* A mesma tela de avulsos da folha: é pagamento da empresa e é
            lançamento da folha, e obrigar a trocar de módulo no meio do
            trabalho custaria mais que o caminho repetido.

            Aqui ela abre pelo cadastro de fornecedores do IXC: neste módulo se
            paga qualquer um deles, e não só quem esta casa já cadastrou. Na
            folha continua sendo a lista de cá. */}
        <Route path="avulsos" element={<Avulsos doIxc />} />
        <Route path="recorrentes" element={<Recorrentes />} />
        <Route path="categorias" element={<ContasPagarCategorias />} />
      </Route>

      <Route path="*" element={<Navigate to="/modulos" replace />} />
    </Routes>
  );
}
