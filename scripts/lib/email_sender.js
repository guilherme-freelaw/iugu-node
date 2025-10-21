'use strict';

const nodemailer = require('nodemailer');

/**
 * Envia um e-mail com relatório de sincronização
 * @param {Object} options
 * @param {string} options.to - Destinatário
 * @param {string} options.subject - Assunto
 * @param {string} options.text - Conteúdo texto
 * @param {string} options.html - Conteúdo HTML
 */
async function sendEmail({ to, subject, text, html }) {
  // Configurações de e-mail
  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = process.env.SMTP_PORT || 587;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;

  // Verificar se as credenciais estão configuradas
  if (!SMTP_USER || !SMTP_PASS) {
    console.log('⚠️ E-mail não enviado: SMTP_USER e SMTP_PASS não configurados');
    return { skipped: true, reason: 'Credenciais não configuradas' };
  }

  try {
    // Criar transporter
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true para 465, false para outras portas
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // Enviar e-mail
    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    console.log(`✅ E-mail enviado para ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Erro ao enviar e-mail: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Gera HTML do relatório de sincronização
 */
function generateReportHTML(results, stats) {
  const timestamp = new Date().toLocaleString('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const duration = stats.duration || 0;
  const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);

  // Determinar status geral
  let statusEmoji = '✅';
  let statusText = 'Sucesso';
  let statusColor = '#10b981';

  if (totalRecords === 0) {
    statusEmoji = '⚠️';
    statusText = 'Nenhum registro novo';
    statusColor = '#f59e0b';
  } else if (stats.hasErrors) {
    statusEmoji = '⚠️';
    statusText = 'Concluído com avisos';
    statusColor = '#f59e0b';
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .status {
      display: inline-block;
      background: ${statusColor};
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      margin-top: 10px;
    }
    .content {
      background: #f9fafb;
      padding: 30px;
      border-radius: 0 0 10px 10px;
    }
    .metric {
      background: white;
      padding: 15px;
      margin: 10px 0;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-left: 4px solid #667eea;
    }
    .metric-label {
      font-weight: 500;
      color: #6b7280;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #111827;
    }
    .summary {
      background: #eff6ff;
      border: 2px solid #3b82f6;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .summary-title {
      font-weight: bold;
      color: #1e40af;
      margin-bottom: 10px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 12px;
    }
    .timestamp {
      color: #9ca3af;
      font-size: 14px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${statusEmoji} Relatório de Sincronização Iugu</h1>
    <div class="status">${statusText}</div>
    <div class="timestamp">${timestamp}</div>
  </div>

  <div class="content">
    <div class="summary">
      <div class="summary-title">📊 Resumo da Sincronização</div>
      <div><strong>Total de registros:</strong> ${totalRecords}</div>
      <div><strong>Duração:</strong> ${duration.toFixed(2)}s</div>
    </div>

    <h3 style="color: #374151; margin-top: 25px;">Detalhamento por Entidade:</h3>

    <div class="metric">
      <span class="metric-label">📄 Faturas</span>
      <span class="metric-value">${results.invoices || 0}</span>
    </div>

    <div class="metric">
      <span class="metric-label">👥 Clientes</span>
      <span class="metric-value">${results.customers || 0}</span>
    </div>

    <div class="metric">
      <span class="metric-label">📋 Assinaturas</span>
      <span class="metric-value">${results.subscriptions || 0}</span>
    </div>

    <div class="metric">
      <span class="metric-label">📊 Planos</span>
      <span class="metric-value">${results.plans || 0}</span>
    </div>

    <div class="metric">
      <span class="metric-label">⚡ Chargebacks</span>
      <span class="metric-value">${results.chargebacks || 0}</span>
    </div>

    <div class="metric">
      <span class="metric-label">💸 Transferências</span>
      <span class="metric-value">${results.transfers || 0}</span>
    </div>

    <div class="metric">
      <span class="metric-label">💳 Métodos de Pagamento</span>
      <span class="metric-value">${results.payment_methods || 0}</span>
    </div>
  </div>

  <div class="footer">
    Sincronização automática Iugu → Supabase<br>
    Sistema de relatórios - FreeLaw
  </div>
</body>
</html>
  `.trim();
}

/**
 * Gera texto simples do relatório
 */
function generateReportText(results, stats) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const duration = stats.duration || 0;
  const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);

  return `
RELATÓRIO DE SINCRONIZAÇÃO IUGU → SUPABASE
${timestamp}

═══════════════════════════════════════════

RESUMO:
  Total de registros: ${totalRecords}
  Duração: ${duration.toFixed(2)}s

DETALHAMENTO:
  📄 Faturas:              ${results.invoices || 0}
  👥 Clientes:             ${results.customers || 0}
  📋 Assinaturas:          ${results.subscriptions || 0}
  📊 Planos:               ${results.plans || 0}
  ⚡ Chargebacks:          ${results.chargebacks || 0}
  💸 Transferências:       ${results.transfers || 0}
  💳 Métodos de Pagamento: ${results.payment_methods || 0}

═══════════════════════════════════════════

Sistema de sincronização automática
  `.trim();
}

module.exports = {
  sendEmail,
  generateReportHTML,
  generateReportText,
};
