# Iugu para node.js [![Build Status](https://travis-ci.org/iugu/iugu-node.png?branch=master)](https://travis-ci.org/iugu/iugu-node)

## Instalação

`npm install iugu`

## Exemplo de Uso
```js
var iugu = require('iugu')('c73d49f9-6490-46ee-ba36-dcf69f6334fd'); // Ache sua chave API no Painel
// iugu.{ RESOURCE_NAME }.{ METHOD_NAME }
```
Todo método aceita um callback opcional como ultimo argumento:

```js
iugu.customer.create({
  'email': 'email@email.com',
  'name': 'Nome do Cliente',
  'notes': 'Anotações Gerais'
  }, function(err, customer) {
    err; // null se não ocorreu nenhum erro
    customer; // O objeto de retorno da criação
  }
);
```

## Documentação
Acesse [iugu.com/documentacao](http://iugu.com/documentacao) para referência

## Configuração

 * `iugu.setApiKey('c73d49f9-6490-46ee-ba36-dcf69f6334fd');`
 * `iugu.setTimeout(20000); // in ms` (node's default: `120000ms`)

### Ambiente (.env)

- Copie `.env.example` para `.env` e preencha as variáveis (`IUGU_API_TOKEN`, `IUGU_API_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- Não commite o `.env` (já está listado no `.gitignore`).
- Se alguma chave real tiver sido exposta, rotacione-a imediatamente.

## Testes
Execute :

`npm test`

## Notas de uso

- Requisições `GET` agora enviam filtros como query string na URL e não enviam corpo. Ex.: `iugu.invoices.list({ limit: 25 })` gera `GET /v1/invoices?limit=25`.
- Parâmetro legado `count` é mapeado para `limit` automaticamente para compatibilidade.
- Métricas de receita devem considerar apenas faturas com `status` `paid` e `partially_paid` (soma por `paid_cents`). Status como `externally_paid`, `authorized`, `draft`, `pending`, `canceled`, `expired`, `refunded`, `in_protest`, `chargeback` não entram como receita reconhecida.

### Supabase Realtime

1) Aplique a migração 029 para adicionar descrições e habilitar a publicação Realtime:

```bash
# Execute o SQL no Supabase SQL Editor ou seu fluxo de migrações
# Arquivo: supabase/migrations/029_comments_and_realtime.sql
```

2) Escute eventos Realtime localmente (requer `SUPABASE_URL` e `SUPABASE_ANON_KEY` no `.env`):

```bash
npm run realtime:listen -- iugu_invoices
```

3) Exemplo (React) para atualizar UI automaticamente quando faturas mudarem:

```tsx
import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export function useInvoicesRealtime(onChange: (payload: any) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('realtime:iugu_invoices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'iugu_invoices' }, onChange)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [onChange]);
}
```

RLS: Para receber Realtime como `anon`/`authenticated`, crie policies que permitam `SELECT` nas tabelas necessárias. Service role bypassa RLS, mas não deve ser usado no navegador.

## Autor

Originalmente por [Luis Specian](https://github.com/lspecian) (luis@specian.com.br).
