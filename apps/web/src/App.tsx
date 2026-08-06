import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { Avulsos } from './pages/Avulsos';
import { Configuracoes } from './pages/Configuracoes';
import { ContasPagar } from './pages/ContasPagar';
import { Dashboard } from './pages/Dashboard';
import { Folha } from './pages/Folha';
import { FuncionarioDetalhe } from './pages/FuncionarioDetalhe';
import { Funcionarios } from './pages/Funcionarios';
import { Login } from './pages/Login';
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
        <Route path="vales" element={<Vales />} />
        <Route path="folha" element={<Folha />} />
        <Route path="contas-pagar" element={<ContasPagar />} />
        <Route path="avulsos" element={<Avulsos />} />
        <Route path="configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
