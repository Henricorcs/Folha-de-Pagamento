import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { Avulsos } from './pages/Avulsos';
import { Configuracoes } from './pages/Configuracoes';
import { ContasPagar } from './pages/ContasPagar';
import { Dashboard } from './pages/Dashboard';
import { Diaristas } from './pages/Diaristas';
import { Ferias } from './pages/Ferias';
import { Folha } from './pages/Folha';
import { FuncionarioDetalhe } from './pages/FuncionarioDetalhe';
import { Funcionarios } from './pages/Funcionarios';
import { Impostos } from './pages/Impostos';
import { Login } from './pages/Login';
import { MinhaConta } from './pages/MinhaConta';
import { Usuarios } from './pages/Usuarios';
import { Vales } from './pages/Vales';
import type { ReactNode } from 'react';

function Protegida({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth();
  if (carregando) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
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
    <Navigate to="/dashboard" replace />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protegida>
            <Layout />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="funcionarios" element={<Funcionarios />} />
        <Route path="funcionarios/:id" element={<FuncionarioDetalhe />} />
        <Route path="diaristas" element={<Diaristas />} />
        <Route path="vales" element={<Vales />} />
        <Route path="ferias" element={<Ferias />} />
        <Route path="folha" element={<Folha />} />
        <Route path="contas-pagar" element={<ContasPagar />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
