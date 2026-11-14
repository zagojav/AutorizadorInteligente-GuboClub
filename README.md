# 🏥 Autorizador Inteligente — Gubo Club

> **Hack Inova — Desafio 3**  
> Orquestração inteligente de solicitações médicas combinando a velocidade da Inteligência Artificial com a segurança rigorosa das regras regulatórias.

---

## 🎯 O Problema
No fluxo hospitalar atual, a liberação de procedimentos médicos depende de integrações externas com operadoras de saúde que sofrem com instabilidade frequente. Isso gera dois grandes gargalos:
* **Lentidão no atendimento:** Quando um convênio sai do ar, a recepção trava e os pacientes enfrentam horas de espera.
* **Risco regulatório e financeiro (Glosas):** A pressão por agilidade pode levar à liberação de procedimentos sem a confirmação oficial da operadora, gerando prejuízos diretos para clínicas e hospitais.

---

## 💡 A Solução
O **Autorizador Inteligente** atua como uma camada de resiliência e triagem entre o hospital e os convênios, operando em três pilares:

1. **IA Sugere:** Classifica e estrutura a solicitação médica automaticamente.
2. **Regra Decide:** Bloqueio estrito contra alucinações — o sistema **nunca** inventa um protocolo e só autoriza o atendimento mediante o retorno do número oficial do convênio.
3. **Humano Resolve:** Casos de exceção ou divergência são encaminhados para uma fila dedicada do operador, já acompanhados do motivo auditado e de um texto de apoio pronto para agilizar a resolução.

---

## ⚙️ Arquitetura e Resiliência
* **Filas Isoladas por Convênio:** Cada operadora possui sua própria fila de processamento. Se o *Convênio B* apresentar instabilidade, sua fila é pausada sem afetar o fluxo dos *Convênios A e C*.
* **Circuit Breaker (Disjuntor):** Ao detectar 3 falhas consecutivas de comunicação com uma operadora, o disjuntor abre automaticamente, isolando o convênio instável até sua normalização.
* **Auditoria Automatizada:** Registro detalhado de divergências para rastreabilidade completa e prevenção de glosas.

---

## 📊 Validação Técnica (MVP)
Durante os testes em ambiente controlado, o motor foi validado com foco em estabilidade e consistência:
* **25 cenários** de testes automatizados executados com sucesso.
* **17 chamadas críticas** validadas com paridade de comportamento entre arquiteturas (Java / Node).
* **15 divergências** identificadas proativamente pelo módulo auditor antes de gerarem impacto financeiro.

---

## 🚀 Próximos Passos
* Integração real no padrão oficial da ANS (**TISS**) com operadora parceira.
* Painel analítico de SLA e monitoramento preditivo de instabilidade por convênio.

---

## 👥 Equipe — Gubo Club
* **Gabriel Rodrigues**
* **Guilherme Lima**
* **Guilherme Zago**
