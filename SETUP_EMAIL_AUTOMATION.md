# Configuração de E-mail Automático - Sincronização Iugu

## 📧 O que foi configurado

Sistema de e-mails automáticos para **Bianca** (`bianca@freelaw.work`) sobre o status das sincronizações de dados Iugu.

### Frequência
- ✅ **A cada 30 minutos** via GitHub Actions
- 📧 E-mail enviado após cada execução (sucesso ou erro)

### Script utilizado
- **`hourly_sync.js`** - Sincroniza invoices, customers e subscriptions incrementalmente

---

## 🔧 Secrets necessários no GitHub

Para ativar os e-mails automáticos, você precisa configurar os seguintes **secrets** no GitHub:

### Como adicionar secrets:
1. Vá para: `https://github.com/[seu-repo]/settings/secrets/actions`
2. Clique em "New repository secret"
3. Adicione cada um dos secrets abaixo:

### Secrets de SMTP (E-mail):

```
SMTP_HOST
Exemplo: smtp.gmail.com
Descrição: Servidor SMTP para envio de e-mails

SMTP_PORT
Exemplo: 587
Descrição: Porta do servidor SMTP (587 para TLS, 465 para SSL)

SMTP_USER
Exemplo: seu-email@gmail.com
Descrição: Usuário/e-mail para autenticação SMTP

SMTP_PASS
Exemplo: sua-senha-de-app
Descrição: Senha de aplicativo do e-mail (não use senha normal!)

EMAIL_FROM
Exemplo: sync-iugu@freelaw.work
Descrição: E-mail remetente (opcional, usa SMTP_USER por padrão)
```

### Secrets já existentes (mantenha):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `IUGU_API_TOKEN`
- `IUGU_API_BASE_URL`

---

## 📧 Como obter senha de aplicativo (Gmail)

Se usar Gmail, você precisa gerar uma **senha de aplicativo**:

1. Acesse: https://myaccount.google.com/security
2. Ative a "Verificação em duas etapas" (se ainda não estiver)
3. Vá em "Senhas de app": https://myaccount.google.com/apppasswords
4. Selecione "App: Mail" e "Dispositivo: Outro"
5. Dê um nome (ex: "Iugu Sync Automation")
6. Copie a senha gerada e use como `SMTP_PASS`

---

## 🧪 Testar localmente

Para testar o envio de e-mail localmente, adicione no seu `.env`:

```bash
# Configurações SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha-de-app
EMAIL_FROM=sync-iugu@freelaw.work
EMAIL_TO=bianca@freelaw.work

# Configurações existentes
IUGU_API_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Execute:
```bash
npm run sync:hourly
```

---

## 📊 O que a Bianca vai receber

### E-mail de Sucesso:
- ✅ Assunto: "Sincronização Iugu concluída - [data/hora]"
- Resumo de registros sincronizados (invoices, customers, subscriptions)
- Duração da execução
- Design bonito com cores e métricas

### E-mail de Erro:
- ❌ Assunto: "Erro na sincronização Iugu - [data/hora]"
- Detalhes do erro
- Duração até a falha
- Design destacando o problema

---

## 📁 Arquivos modificados

- ✅ `scripts/hourly_sync.js` - Adicionado envio de e-mail
- ✅ `.github/workflows/hourly-sync.yml` - Workflow automático criado
- ✅ `package.json` - Adicionado script `npm run sync:hourly`
- ✅ `scripts/lib/email_sender.js` - Biblioteca de e-mail (já existia)

---

## 🚀 Próximos passos

1. **Adicionar secrets no GitHub** (veja seção acima)
2. **Ativar o workflow** (vai rodar automaticamente após commit)
3. **Verificar primeiro e-mail** em 30 minutos

---

## 🔍 Monitoramento

- Ver execuções: `https://github.com/[seu-repo]/actions`
- Workflow: "Hourly Iugu Data Sync"
- Logs de cada execução disponíveis no GitHub Actions
