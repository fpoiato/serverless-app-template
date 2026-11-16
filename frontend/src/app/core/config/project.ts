// Fonte única dos dados do projeto (domínio, nome, locale): project.config.json na raiz do repositório.
import project from '../../../../../project.config.json';

export const PROJECT = {
  slug: project.slug,
  displayName: project.displayName,
  domain: project.domain,
  locale: project.locale ?? 'pt-BR',
  currency: project.currency ?? 'BRL',
};
