import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const navItems = [
  { to: '/funcionarios', label: 'Funcionários', icon: '👥' },
  { to: '/folha', label: 'Gerar Folha', icon: '🧮' },
  { to: '/contas-pagar', label: 'Contas a Pagar', icon: '💸' },
  { to: '/avulsos', label: 'Pagamentos Avulsos', icon: '🧾' },
  { to: '/configuracoes', label: 'Configurações', icon: '⚙️' },
];

export function Layout() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col bg-slate-900 text-slate-200">
        <div className="px-5 py-5 text-lg font-semibold tracking-tight">
          <span className="text-brand-400">Folha</span> de Pagamento
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-4 text-sm">
          <div className="font-medium text-slate-100">{usuario?.nome}</div>
          <div className="text-xs text-slate-400">{usuario?.email}</div>
          <button
            onClick={sair}
            className="mt-3 w-full rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
