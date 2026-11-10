// Todos os dados abaixo são fictícios (IPs mascarados, domínios .example).
// Critérios da avaliação: evidências, análise, contenção, comunicação (0-100).
const CRITERIA = [
  ["ev", "Preservação de evidências", 0.30],
  ["an", "Análise e correlação", 0.30],
  ["ct", "Contenção proporcional", 0.25],
  ["cm", "Registro e comunicação", 0.15]
];
// Perfis-base por tipo de decisão. Cada cenário pode ajustar com "tweak".
const BASE = {
  investigate: { ev: 95, an: 90, ct: 55, cm: 80 },
  contain:     { ev: 65, an: 60, ct: 90, cm: 70 },
  ignore:      { ev: 20, an: 0,  ct: 0,  cm: 0,  critical: true },
  destroy:     { ev: 0,  an: 10, ct: 20, cm: 0,  critical: true }
};
function evaluate(scenario, type) {
  const fb = scenario.feedback[type];
  const c = { ...BASE[type], ...(fb.tweak || {}) };
  const critical = !!c.critical;
  const raw = CRITERIA.reduce((s, [k, , w]) => s + c[k] * w, 0);
  return { score: critical ? 0 : Math.round(raw), criteria: c, critical, text: fb.text };
}

const SCENARIOS = {
  brute_force: {
    id: "INC-2026-001", severity: "ALTO", category: "Autenticação", asset: "Servidor de acesso", ago: "há 4 min",
    title: "Possível comprometimento de conta administrativa",
    summary: "47 falhas de autenticação seguidas de um login bem-sucedido em conta privilegiada.",
    description: "O sistema de monitoramento identificou uma sequência anormal de falhas de autenticação, seguida de um acesso bem-sucedido a uma conta com privilégios administrativos.",
    facts: [["TENTATIVAS FALHAS", "47"], ["CONTA AFETADA", "administrator"], ["ORIGEM (FICTÍCIA)", "185.XX.XX.42"], ["HORÁRIO", "03:14:22"]],
    logs: [["03:12:01", "185.XX.XX.42", "Falha de autenticação", "NEGADO"], ["03:12:45", "185.XX.XX.42", "Falha de autenticação", "NEGADO"], ["03:13:59", "185.XX.XX.42", "Login administrativo", "SUCESSO"], ["03:14:22", "10.0.0.15", "Alerta de privilégio", "ALERTA"]],
    choices: [
      ["investigate", "Validar os logs e preservar evidências", "Correlacionar eventos, horários e escopo antes de concluir."],
      ["contain", "Conter o acesso suspeito", "Revogar sessões e restringir temporariamente a conta afetada, seguindo o procedimento."],
      ["ignore", "Ignorar o alerta", "Considerar que as falhas podem ser apenas erro de digitação."],
      ["destroy", "Apagar os registros para limpar o servidor", "Remover os eventos de autenticação do sistema."]
    ],
    feedback: {
      investigate: { text: "Boa decisão: você começou pela validação e preservação das evidências. Correlacione os eventos, confirme se o login foi legítimo e determine o escopo. Se o comprometimento for confirmado, avance para contenção." },
      contain: { text: "A contenção pode reduzir o impacto, mas deve ser proporcional e acompanhada de preservação de evidências. Registre a ação, revogue sessões suspeitas e continue a investigação.", tweak: { ct: 95 } },
      ignore: { text: "Decisão inadequada. Um login administrativo bem-sucedido após dezenas de falhas exige validação imediata. Ignorar o alerta pode permitir que uma conta comprometida continue sendo usada." },
      destroy: { text: "Decisão crítica e inadequada. Apagar logs destrói evidências, prejudica a linha do tempo e dificulta determinar o impacto. Preserve os registros originais." }
    }
  },
  dns: {
    id: "INC-2026-002", severity: "MÉDIO", category: "Rede", asset: "Estação WS-014", ago: "há 18 min",
    title: "Volume incomum de consultas DNS",
    summary: "Pico de consultas para domínio recém-observado em estação de trabalho.",
    description: "Uma estação de trabalho apresentou aumento repentino de consultas DNS para um domínio recém-observado. Ainda não há confirmação de comprometimento.",
    facts: [["CONSULTAS / 5 MIN", "1.280"], ["ATIVO", "WS-014"], ["DOMÍNIO (FICTÍCIO)", "sync-check.example"], ["HORÁRIO", "02:59:08"]],
    logs: [["02:58:41", "10.0.0.24", "Consulta DNS repetida", "ALERTA"], ["02:58:56", "10.0.0.24", "Domínio novo observado", "ALERTA"], ["02:59:08", "10.0.0.24", "Pico de consultas DNS", "ALERTA"], ["02:59:30", "10.0.0.24", "Conexão de saída", "PENDENTE"]],
    choices: [
      ["contain", "Aplicar contenção temporária e proporcional", "Restringir a comunicação suspeita após validar o risco e preservar dados."],
      ["ignore", "Ignorar por ser apenas tráfego DNS", "Assumir que consultas DNS nunca representam risco."],
      ["investigate", "Correlacionar consultas e identificar o processo", "Verificar processo, destino, frequência e histórico da estação."],
      ["destroy", "Apagar os logs DNS", "Remover os registros para reduzir o volume."]
    ],
    feedback: {
      investigate: { text: "Boa decisão. O volume é um indicador, não uma confirmação de malware. Correlacione DNS, processo responsável, destino e linha do tempo antes de classificar o incidente.", tweak: { an: 95 } },
      contain: { text: "Pode ser adequado se houver evidência adicional de risco. Registre a justificativa e evite interromper serviços legítimos sem validação.", tweak: { ct: 80, an: 55 } },
      ignore: { text: "Inadequado. O volume incomum e o domínio recém-observado justificam investigação. Não conclua que é malicioso, mas também não descarte o alerta." },
      destroy: { text: "Inadequado. Os registros DNS são evidências importantes para identificar origem, frequência e possíveis destinos. Preserve-os." }
    }
  },
  firewall: {
    id: "INC-2026-003", severity: "BAIXO", category: "Configuração", asset: "Firewall FW-02", ago: "há 32 min",
    title: "Alteração de configuração fora da janela",
    summary: "Modificação em regra de firewall fora da janela de manutenção.",
    description: "Uma regra de firewall foi modificada fora da janela de manutenção prevista. É necessário confirmar a autorização e avaliar a exposição criada.",
    facts: [["ATIVO", "FW-02"], ["REGRA", "ALLOW-EXT-22"], ["ALTERAÇÃO", "Porta 8443"], ["HORÁRIO", "02:45:51"]],
    logs: [["02:45:51", "admin-local", "Regra modificada", "ALERTA"], ["02:45:53", "FW-02", "Porta 8443 liberada", "SUCESSO"], ["02:46:10", "change-mgmt", "Sem mudança agendada", "PENDENTE"], ["02:47:02", "FW-02", "Configuração salva", "SUCESSO"]],
    choices: [
      ["destroy", "Apagar o histórico de alteração", "Remover a trilha de auditoria."],
      ["investigate", "Validar a mudança com o responsável e comparar configurações", "Consultar trilha de auditoria, solicitação e baseline."],
      ["ignore", "Ignorar porque a regra foi salva sem erro", "Confundir sucesso técnico com autorização."],
      ["contain", "Reverter a regra após validar impacto e autorização", "Aplicar rollback controlado se a alteração não for autorizada."]
    ],
    feedback: {
      investigate: { text: "Boa decisão. Confirme a autoria, a solicitação e o impacto da mudança. Compare com a configuração anterior e registre a conclusão.", tweak: { cm: 90 } },
      contain: { text: "Pode ser adequado após confirmar que a alteração é indevida e avaliar dependências. Faça rollback controlado e documentado.", tweak: { ct: 92 } },
      ignore: { text: "Inadequado. Uma alteração fora da janela precisa ser validada, mesmo que tenha sido aplicada sem erro técnico." },
      destroy: { text: "Inadequado. A trilha de auditoria é essencial para atribuição e investigação. Preserve o histórico." }
    }
  },
  phishing: {
    id: "INC-2026-004", severity: "MÉDIO", category: "E-mail", asset: "Gateway de e-mail", ago: "há 41 min",
    title: "E-mail suspeito reportado por usuário",
    summary: "Mensagem com anexo HTML enviada a 12 usuários; 3 clicaram no link.",
    description: "Um usuário reportou uma mensagem que simula uma cobrança. O anexo abre uma página que solicita credenciais corporativas. Três usuários interagiram com o conteúdo antes do alerta.",
    facts: [["DESTINATÁRIOS", "12"], ["CLIQUES", "3"], ["REMETENTE (FICTÍCIO)", "cobranca@pagamentos-seguros.example"], ["HORÁRIO", "02:31:07"]],
    logs: [["02:30:12", "mail-gw", "Mensagem entregue a 12 caixas", "SUCESSO"], ["02:36:40", "proxy", "Acesso a pagamentos-seguros.example", "ALERTA"], ["02:37:02", "proxy", "Envio de formulário (POST)", "ALERTA"], ["02:41:15", "helpdesk", "Usuário reportou e-mail suspeito", "PENDENTE"]],
    choices: [
      ["ignore", "Orientar os usuários a apenas apagar o e-mail", "Considerar o caso encerrado sem verificar quem clicou."],
      ["contain", "Remover a mensagem das caixas e redefinir senhas de quem clicou", "Bloquear o domínio no proxy e revogar sessões dos três usuários."],
      ["destroy", "Excluir o e-mail do servidor sem guardar cópia", "Eliminar a mensagem original para evitar novos cliques."],
      ["investigate", "Preservar a mensagem e analisar cabeçalhos e anexo em ambiente isolado", "Identificar quem clicou e se houve envio de credenciais."]
    ],
    feedback: {
      investigate: { text: "Boa decisão: a mensagem original e os cabeçalhos são evidência. Mas há 3 cliques e um envio de formulário nos logs; avance logo para contenção das contas afetadas.", tweak: { ct: 35 } },
      contain: { text: "Ótima prioridade para reduzir o impacto: há indício de envio de credenciais. Preserve uma cópia da mensagem antes de removê-la e registre quem foi afetado.", tweak: { ct: 100, ev: 70, an: 70, cm: 80 } },
      ignore: { text: "Inadequado. Apagar o e-mail sem verificar cliques deixa credenciais possivelmente expostas. Os logs do proxy já mostram envio de formulário." },
      destroy: { text: "Inadequado. Sem a mensagem original não é possível analisar cabeçalhos, anexo e indicadores. Preserve uma cópia antes de remover das caixas." }
    }
  },
  ransomware: {
    id: "INC-2026-005", severity: "CRÍTICO", category: "Endpoint", asset: "Servidor FS-01", ago: "há 2 min",
    title: "Alterações em massa em arquivos do servidor",
    summary: "3.400 arquivos renomeados em 10 minutos com extensão desconhecida.",
    description: "O servidor de arquivos FS-01 apresenta renomeação e alteração massiva de arquivos com uma extensão não reconhecida, em ritmo crescente. O comportamento é compatível com cifragem maliciosa. O último backup foi concluído às 02:00.",
    facts: [["ARQUIVOS ALTERADOS", "3.400 / 10 min"], ["ATIVO", "FS-01"], ["EXTENSÃO (FICTÍCIA)", ".locked-lab"], ["ÚLTIMO BACKUP", "02:00:00"]],
    logs: [["03:20:11", "FS-01", "Renomeação em massa", "ALERTA"], ["03:21:40", "FS-01", "Extensão .locked-lab criada", "ALERTA"], ["03:22:05", "EDR", "Processo desconhecido grava em \\share", "ALERTA"], ["03:22:30", "FS-01", "Taxa de alterações crescente", "PENDENTE"]],
    choices: [
      ["investigate", "Coletar todos os logs antes de qualquer ação", "Aguardar a análise completa antes de mexer no servidor."],
      ["destroy", "Formatar o servidor e restaurar o backup agora", "Reinstalar imediatamente sem coletar evidências."],
      ["contain", "Isolar o servidor da rede mantendo-o ligado", "Cortar a propagação e preservar memória e logs para análise."],
      ["ignore", "Aguardar o fim do expediente", "Tratar como lentidão pontual e revisar depois."]
    ],
    feedback: {
      contain: { text: "Melhor decisão aqui: o dano cresce a cada minuto, então contenção rápida vem primeiro. Isolar sem desligar preserva memória e logs. Depois: identificar o processo, verificar outros hosts e validar a integridade do backup.", tweak: { ev: 80, an: 75, ct: 100, cm: 85 } },
      investigate: { text: "Preservar evidências é importante, mas esperar a análise completa enquanto os arquivos são cifrados aumenta o impacto. Em incidentes de rápida propagação, contenha primeiro e investigue em seguida.", tweak: { ct: 15, cm: 60 } },
      ignore: { text: "Decisão crítica e inadequada. A taxa de alterações é crescente e cada minuto aumenta a perda de dados. Este alerta exige ação imediata." },
      destroy: { text: "Decisão crítica e inadequada. Formatar destrói evidências (memória, malware, vetor de entrada) e pode restaurar o servidor sem corrigir a causa, permitindo nova infecção." }
    }
  }
};

// Eventos simulados para o feed da visão geral.
const FEED_POOL = [
  ["INFO", "Login bem-sucedido", "usuario.demo", "10.0.0.31"],
  ["INFO", "Atualização de antivírus concluída", "WS-021", "10.0.0.45"],
  ["INFO", "Backup incremental concluído", "FS-01", "10.0.0.5"],
  ["AVISO", "Falha de autenticação", "svc-backup", "10.0.0.77"],
  ["AVISO", "Certificado expira em 14 dias", "WEB-01", "10.0.0.9"],
  ["AVISO", "Varredura de portas bloqueada", "externo", "203.0.XX.17"],
  ["INFO", "Política de senha aplicada", "AD-01", "10.0.0.2"],
  ["ALERTA", "Consulta DNS para domínio raro", "WS-014", "10.0.0.24"],
  ["INFO", "Sessão VPN encerrada", "usuario.demo2", "10.0.0.88"],
  ["AVISO", "Uso de CPU acima de 90%", "DB-01", "10.0.0.12"]
];
