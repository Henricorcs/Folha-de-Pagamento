import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/**
 * Casca do app. A barra lateral é tinta escura para o conteúdo — onde moram os
 * números — ficar sendo a única coisa clara e disputada da tela.
 */
const navItems = [
  { to: '/dashboard', label: 'Dashboard', icone: IconePainel },
  { to: '/funcionarios', label: 'Funcionários', icone: IconePessoas },
  { to: '/diaristas', label: 'Diaristas', icone: IconeDia },
  { to: '/vales', label: 'Vales e Acertos', icone: IconeMoeda },
  { to: '/ferias', label: 'Férias', icone: IconeSol },
  { to: '/folha', label: 'Gerar Folha', icone: IconeCalculo },
  { to: '/contas-pagar', label: 'Contas a Pagar', icone: IconeSaida },
  { to: '/avulsos', label: 'Pagamentos Avulsos', icone: IconeRecibo },
  { to: '/impostos', label: 'Impostos', icone: IconeGuia },
  { to: '/configuracoes', label: 'Configurações', icone: IconeEngrenagem },
  { to: '/usuarios', label: 'Usuários', icone: IconeChave, somenteAdmin: true },
];

export function Layout() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-tinta-50">
      {/* Faixa de menu no celular */}
      <button
        onClick={() => setMenuAberto((a) => !a)}
        className="fixed left-4 top-4 z-50 rounded-xl bg-tinta-900 p-2.5 text-white shadow-lg lg:hidden"
        aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          {menuAberto ? (
            <>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
      </button>

      {menuAberto && (
        <div
          onClick={() => setMenuAberto(false)}
          className="fixed inset-0 z-30 bg-tinta-900/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-tinta-900 transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-6 pb-7 pt-7">
          {/* A logo tem fundo transparente e vive bem sobre a tinta escura —
              o azul dela é claro o bastante para se ler aqui. */}
          <img
            src="/logo-ilnet.png"
            alt="ilnet"
            width={120}
            height={74}
            className="h-auto w-[104px]"
          />
          <div className="mt-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-tinta-400">
            Folha de pagamento
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {navItems
            .filter((item) => !item.somenteAdmin || usuario?.role === 'ADMIN')
            .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuAberto(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-150 ${
                  isActive
                    ? 'bg-white/[0.07] text-white'
                    : 'text-tinta-300 hover:bg-white/[0.04] hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition-all duration-200 ${
                      isActive ? 'opacity-100' : 'scale-y-0 opacity-0'
                    }`}
                  />
                  <item.icone
                    className={
                      isActive
                        ? 'text-brand-400'
                        : 'text-tinta-500 group-hover:text-tinta-300'
                    }
                  />
                  {item.label}
                </>
              )}
              </NavLink>
            ))}
        </nav>

        <div className="m-3 rounded-xl bg-white/[0.04] p-3.5">
          <NavLink
            to="/minha-conta"
            onClick={() => setMenuAberto(false)}
            className="flex items-center gap-2.5 rounded-lg transition hover:opacity-80"
            title="Minha conta"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-xs font-semibold text-brand-300">
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-medium text-white">
                {usuario?.nome}
              </div>
              <div className="truncate text-[11px] text-tinta-400">
                {usuario?.email}
              </div>
            </div>
          </NavLink>
          <button
            onClick={sair}
            className="mt-3 w-full rounded-lg border border-white/10 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tinta-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

// --- Ícones (traço de 1.7 para casar com o peso do texto) ---
type IconeProps = { className?: string };
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconePainel({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function IconePessoas({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.5A5.5 5.5 0 0 1 20.5 20" />
    </svg>
  );
}

/** Um dia marcado no calendário: o trabalho que se conta por diária. */
function IconeDia({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3M16 3v3" />
      <circle cx="12" cy="14.5" r="2" />
    </svg>
  );
}

function IconeMoeda({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.5a2.6 2.6 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.8 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.6 2.6 0 0 1-2.5-1.5" />
      <path d="M12 6.2v1.8M12 16v1.8" />
    </svg>
  );
}

/** Sol: o descanso a que a pessoa tem direito. */
function IconeSol({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" />
      <path d="M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  );
}

function IconeCalculo({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 7.5h8" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </svg>
  );
}

function IconeSaida({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19" />
      <path d="M6.5 15h3" />
    </svg>
  );
}

function IconeRecibo({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 3.5h14v17l-2.3-1.6-2.3 1.6-2.4-1.6L9.6 20.5 7.3 19 5 20.5z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </svg>
  );
}

/** Guia de imposto: papel timbrado com o código de barras embaixo. */
function IconeGuia({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 2.5h13v19h-13z" />
      <path d="M9 7h6M9 10.5h6" />
      <path d="M9 16v2.5M11.5 16v2.5M14 16v2.5" />
    </svg>
  );
}

function IconeChave({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.1-8.1" />
      <path d="m17 6 2.5 2.5" />
      <path d="m14.5 8.5 2.5 2.5" />
    </svg>
  );
}

function IconeEngrenagem({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}
