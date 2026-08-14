import { Bloco, CabecalhoPagina, Pagina, Vazio } from '../../components/ui';

export function Inicio() {
  return (
    <Pagina>
      <CabecalhoPagina
        secao="Visão geral"
        titulo="Contas a Pagar"
        descricao="Todas as saídas da empresa em um lugar só, com vencimentos e comprovantes."
      />
      <Bloco semPadding>
        <Vazio titulo="O módulo está começando">
          Ainda não há nada para mostrar aqui. O cadastro de contas, os
          vencimentos e os comprovantes entram nas próximas etapas.
        </Vazio>
      </Bloco>
    </Pagina>
  );
}
