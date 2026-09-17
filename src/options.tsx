import React, { useState, useEffect } from "react"
import { Storage } from "@plasmohq/storage"
import { 
  ConfigProvider, 
  Layout, 
  Card, 
  Typography, 
  Input, 
  Button, 
  Space, 
  Radio, 
  Alert, 
  Divider, 
  Row, 
  Col, 
  Tag, 
  message, 
  theme,
  Spin,
  Empty,
  Popconfirm
} from "antd"
import { 
  KeyOutlined, 
  ExperimentOutlined, 
  SaveOutlined, 
  ApiOutlined, 
  ThunderboltFilled, 
  LinkOutlined, 
  ReadOutlined,
  ControlOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  StopOutlined,
  HistoryOutlined,
  DeleteOutlined,
  CopyOutlined,
  PlusOutlined
} from "@ant-design/icons"
import "./style.css"

const { Header, Content } = Layout
const { Title, Text, Paragraph, Link } = Typography

const DEFAULT_RECOMMENDED_MODELS = [
  {
    value: "openai/gpt-oss-20b",
    title: "GPT-OSS 20B (OpenAI)",
    tag: <Tag color="green">Recomendado / Ultra Rápido</Tag>,
    description: "Modelo de produção com alta velocidade e raciocínio nos LPUs da Groq. Substituto oficial para o Llama 8B."
  },
  {
    value: "openai/gpt-oss-120b",
    title: "GPT-OSS 120B (OpenAI)",
    tag: <Tag color="blue">Mais Inteligente</Tag>,
    description: "Modelo potente para raciocínio profundo, parágrafos complexos e reescritas elaboradas."
  },
  {
    value: "qwen/qwen3.6-27b",
    title: "Qwen 3.6 27B",
    tag: <Tag color="purple">Multilíngue & Raciocínio</Tag>,
    description: "Excelente consistência sintática, precisão gramatical estrita e vocabulário rico."
  }
]

export default function OptionsPage() {
  const [apiKey, setApiKey] = useState("")
  const [selectedModel, setSelectedModel] = useState("openai/gpt-oss-20b")
  const [customModel, setCustomModel] = useState("")
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testingKey, setTestingKey] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Blacklist state
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([])
  const [newDomainInput, setNewDomainInput] = useState("")

  // History state
  const [historyList, setHistoryList] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const storage = new Storage()
  const [messageApi, contextHolder] = message.useMessage()

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      let historyData: any[] = []
      const raw = await storage.get("groq_correction_history")
      if (raw) {
        historyData = typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])
      }

      if ((!historyData || historyData.length === 0) && chrome?.storage?.local) {
        const local = await chrome.storage.local.get("groq_correction_history")
        if (local?.groq_correction_history) {
          const lRaw = local.groq_correction_history
          historyData = typeof lRaw === "string" ? JSON.parse(lRaw) : (Array.isArray(lRaw) ? lRaw : [])
        }
      }

      setHistoryList(Array.isArray(historyData) ? historyData : [])
    } catch (err) {
      console.error("Erro ao carregar histórico:", err)
      setHistoryList([])
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    // Listen for storage changes in real time
    const handleStorageChange = (changes: any, areaName: string) => {
      if (changes.groq_correction_history) {
        const newRaw = changes.groq_correction_history.newValue
        if (newRaw) {
          const parsed = typeof newRaw === "string" ? JSON.parse(newRaw) : (Array.isArray(newRaw) ? newRaw : [])
          setHistoryList(Array.isArray(parsed) ? parsed : [])
        } else {
          setHistoryList([])
        }
      }
    }

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange)
    }

    return () => {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange)
      }
    }
  }, [])

  useEffect(() => {
    Promise.all([
      storage.get("groq_api_key"),
      storage.get("groq_model"),
      storage.get("groq_available_models"),
      storage.get("ignored_domains")
    ]).then(([key, model, cachedModels, rawDomains]) => {
      if (key) setApiKey(key as string)
      
      const savedModel = (model as string) || "openai/gpt-oss-20b"
      if (
        savedModel === "llama-3.1-8b-instant" || 
        savedModel === "llama-3.3-70b-versatile" || 
        savedModel === "mixtral-8x7b-32768" || 
        savedModel === "gemma2-9b-it"
      ) {
        setSelectedModel("openai/gpt-oss-20b")
      } else {
        setSelectedModel(savedModel)
      }

      if (cachedModels) {
        try {
          const parsed = JSON.parse(cachedModels as string)
          if (Array.isArray(parsed)) setDiscoveredModels(parsed)
        } catch (e) {}
      }

      if (rawDomains) {
        try {
          const parsed = typeof rawDomains === "string" ? JSON.parse(rawDomains) : rawDomains
          if (Array.isArray(parsed)) setIgnoredDomains(parsed)
        } catch (e) {}
      }
    })

    loadHistory()
  }, [])

  const handleFetchAccountModels = async () => {
    if (!apiKey.trim()) {
      messageApi.warning("Insira sua API Key primeiro para listar os modelos da sua conta.")
      return
    }

    setFetchingModels(true)
    try {
      const res = await chrome.runtime.sendMessage({
        action: "get_models",
        apiKey: apiKey.trim()
      })

      if (res.error) {
        messageApi.error("Erro ao listar modelos: " + res.error)
      } else if (res.models && res.models.length > 0) {
        setDiscoveredModels(res.models)
        messageApi.success(`${res.models.length} modelos ativos encontrados na sua conta Groq!`)
      }
    } catch (err: any) {
      messageApi.error("Erro de comunicação: " + err.message)
    } finally {
      setFetchingModels(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    const modelToSave = customModel.trim() || selectedModel
    try {
      await Promise.all([
        storage.set("groq_api_key", apiKey.trim()),
        storage.set("groq_model", modelToSave),
        storage.set("ignored_domains", JSON.stringify(ignoredDomains))
      ])
      messageApi.success("Todas as configurações foram salvas com sucesso!")
    } catch (err) {
      messageApi.error("Erro ao salvar configurações.")
    } finally {
      setSaving(false)
    }
  }

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      messageApi.warning("Insira uma chave antes de testar.")
      return
    }

    setTestingKey(true)
    setTestResult(null)

    try {
      const modelToTest = customModel.trim() || selectedModel
      const response = await chrome.runtime.sendMessage({
        action: "test_key",
        apiKey: apiKey.trim(),
        model: modelToTest
      })

      if (response.error) {
        setTestResult({ success: false, message: response.error })
        messageApi.error("Falha no teste da API Key.")
      } else {
        setTestResult({ 
          success: true, 
          message: `Conexão bem sucedida com a Groq! Modelo operacional utilizado: ${response.modelUsed}` 
        })
        if (response.modelUsed && response.modelUsed !== selectedModel && !customModel) {
          setSelectedModel(response.modelUsed)
        }
        messageApi.success("API Key válida e pronta para uso!")
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err?.message || "Erro desconhecido ao testar conexão." })
      messageApi.error("Falha ao comunicar com o serviço em background.")
    } finally {
      setTestingKey(false)
    }
  }

  const handleRemoveKey = async () => {
    try {
      await storage.remove("groq_api_key")
      setApiKey("")
      setTestResult(null)
      messageApi.success("API Key removida com sucesso!")
    } catch {
      messageApi.error("Erro ao remover API Key.")
    }
  }

  const handleAddDomain = () => {
    const domain = newDomainInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    if (!domain) return
    if (ignoredDomains.includes(domain)) {
      messageApi.warning("Este domínio já está na lista.")
      return
    }
    const updated = [...ignoredDomains, domain]
    setIgnoredDomains(updated)
    setNewDomainInput("")
    storage.set("ignored_domains", JSON.stringify(updated))
    messageApi.success(`Domínio ${domain} adicionado à lista de exclusão.`)
  }

  const handleRemoveDomain = (domainToRemove: string) => {
    const updated = ignoredDomains.filter((d) => d !== domainToRemove)
    setIgnoredDomains(updated)
    storage.set("ignored_domains", JSON.stringify(updated))
    messageApi.info(`Domínio ${domainToRemove} removido.`)
  }

  const handleClearHistory = async () => {
    try {
      await storage.set("groq_correction_history", [])
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ groq_correction_history: [] })
      }
      setHistoryList([])
      messageApi.success("Histórico de correções limpo com sucesso!")
    } catch {
      messageApi.error("Erro ao limpar histórico.")
    }
  }

  const openTestPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/test.html") })
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          colorBgBase: "#141414",
          colorBgContainer: "#1f1f1f",
          colorBgElevated: "#262626",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        }
      }}
    >
      {contextHolder}
      <Layout style={{ minHeight: "100vh", backgroundColor: "#141414", margin: 0, padding: 0 }}>
        {/* Header */}
        <Header 
          style={{ 
            backgroundColor: "#1f1f1f", 
            borderBottom: "1px solid #303030", 
            padding: "16px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "auto",
            minHeight: 72,
            lineHeight: "normal"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div 
              style={{ 
                width: 44, 
                height: 44, 
                borderRadius: 10, 
                backgroundColor: "#111d2c", 
                border: "1px solid #113560",
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center" 
              }}
            >
              <ThunderboltFilled style={{ color: "#1677ff", fontSize: 24 }} />
            </div>
            <div>
              <Title level={4} style={{ color: "#ffffff", margin: 0, fontSize: 18, lineHeight: "24px" }}>
                Configurações da Extensão
              </Title>
              <Text style={{ fontSize: 13, color: "#8c8c8c", display: "block" }}>
                Personalize os modelos de IA da Groq, estilo de escrita e listas de exclusão
              </Text>
            </div>
          </div>

          <Space size={12}>
            <Button 
              icon={<ExperimentOutlined />}
              onClick={openTestPage}
              style={{ backgroundColor: "#262626", borderColor: "#3a3a3a", color: "#d9d9d9" }}
            >
              Playground de Testes
            </Button>
            <Button 
              type="primary" 
              icon={<SaveOutlined />} 
              loading={saving}
              onClick={handleSave}
              style={{ boxShadow: "0 2px 0 rgba(5, 145, 255, 0.1)" }}
            >
              Salvar Alterações
            </Button>
          </Space>
        </Header>

        {/* Main Content Area */}
        <Content style={{ padding: "32px", maxWidth: 980, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>

            {/* Card 1: Groq API Key */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "20px 24px" }}
              title={
                <Space size={8}>
                  <KeyOutlined style={{ color: "#1677ff" }} />
                  <span>Autenticação & Chave da API Groq</span>
                </Space>
              }
            >
              <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14, color: "#8c8c8c" }}>
                A Groq oferece inferência ultra-rápida gratuita em chips LPU. Obtenha sua chave no{" "}
                <Link href="https://console.groq.com/keys" target="_blank" style={{ color: "#1677ff" }}>
                  Groq Console <LinkOutlined />
                </Link>.
              </Paragraph>

              <Row gutter={12} align="middle">
                <Col flex="auto">
                  <Input.Password
                    prefix={<KeyOutlined style={{ color: "#8c8c8c" }} />}
                    placeholder="gsk_..."
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      setTestResult(null)
                    }}
                    style={{ height: 40, backgroundColor: "#141414", borderColor: "#303030", fontSize: 13 }}
                  />
                </Col>
                <Col>
                  <Button 
                    icon={<ApiOutlined />}
                    loading={testingKey}
                    onClick={handleTestKey}
                    style={{ height: 40, padding: "0 18px", backgroundColor: "#262626", borderColor: "#3a3a3a", color: "#d9d9d9" }}
                  >
                    Testar Conexão
                  </Button>
                </Col>
                {apiKey && (
                  <Col>
                    <Popconfirm
                      title="Remover API Key"
                      description="Tem certeza que deseja apagar a chave salva da Groq?"
                      onConfirm={handleRemoveKey}
                      okText="Sim, remover"
                      cancelText="Cancelar"
                    >
                      <Button 
                        danger
                        icon={<DeleteOutlined />}
                        style={{ height: 40, padding: "0 16px" }}
                      >
                        Remover Chave
                      </Button>
                    </Popconfirm>
                  </Col>
                )}
              </Row>

              {testResult && (
                <div style={{ marginTop: 14 }}>
                  <Alert
                    type={testResult.success ? "success" : "error"}
                    showIcon
                    message={testResult.success ? "Chave Validada com Sucesso" : "Falha na Verificação"}
                    description={testResult.message}
                  />
                </div>
              )}
            </Card>

            {/* Card 2: AI Model Selection */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "20px 24px" }}
              title={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <Space size={8}>
                    <ControlOutlined style={{ color: "#1677ff" }} />
                    <span>Modelo Ativo na Groq</span>
                  </Space>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={fetchingModels}
                    onClick={handleFetchAccountModels}
                    style={{ fontSize: 12, backgroundColor: "#262626", borderColor: "#3a3a3a", color: "#d9d9d9" }}
                  >
                    Descobrir Modelos da Conta
                  </Button>
                </div>
              }
            >
              <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16, color: "#8c8c8c" }}>
                A Groq descomissionou modelos antigos como Llama 8B e Mixtral. Selecione um dos modelos de produção ativos recomendados abaixo.
              </Paragraph>

              <Radio.Group 
                value={selectedModel} 
                onChange={(e) => {
                  setSelectedModel(e.target.value)
                  setCustomModel("")
                }}
                style={{ width: "100%" }}
              >
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {DEFAULT_RECOMMENDED_MODELS.map((model) => (
                    <Card
                      key={model.value}
                      size="small"
                      hoverable
                      onClick={() => {
                        setSelectedModel(model.value)
                        setCustomModel("")
                      }}
                      style={{
                        borderColor: selectedModel === model.value && !customModel ? "#1677ff" : "#303030",
                        backgroundColor: selectedModel === model.value && !customModel ? "#111b26" : "#141414",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                      bodyStyle={{ padding: "12px 16px" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Radio value={model.value}>
                          <Text strong style={{ fontSize: 13, marginLeft: 4, color: "#ffffff" }}>
                            {model.title}
                          </Text>
                          <code style={{ fontSize: 11, marginLeft: 8, color: "#8c8c8c" }}>({model.value})</code>
                        </Radio>
                        {model.tag}
                      </div>
                      <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 6, marginBottom: 0, paddingLeft: 24, color: "#8c8c8c" }}>
                        {model.description}
                      </Paragraph>
                    </Card>
                  ))}

                  {/* Discovered Models from Account */}
                  {discoveredModels.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed #303030" }}>
                      <Text strong style={{ fontSize: 12, color: "#d9d9d9", display: "block", marginBottom: 8 }}>
                        Outros Modelos Detectados na Sua Conta:
                      </Text>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {discoveredModels.map((id) => (
                          <Tag.CheckableTag
                            key={id}
                            checked={selectedModel === id}
                            onChange={(checked) => {
                              if (checked) {
                                setSelectedModel(id)
                                setCustomModel("")
                              }
                            }}
                            style={{ 
                              padding: "4px 10px", 
                              fontSize: 12, 
                              border: "1px solid #303030",
                              backgroundColor: selectedModel === id ? "#1677ff" : "#1a1a1a"
                            }}
                          >
                            {id}
                          </Tag.CheckableTag>
                        ))}
                      </div>
                    </div>
                  )}
                </Space>
              </Radio.Group>

              {/* Custom Model ID Input */}
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #303030" }}>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
                  Ou especifique um ID de modelo customizado:
                </Text>
                <Input
                  placeholder="Ex: openai/gpt-oss-20b"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  style={{ height: 36, backgroundColor: "#141414", borderColor: "#303030" }}
                />
              </div>
            </Card>

            {/* Card 3: Blacklist / Ignored Domains */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "20px 24px" }}
              title={
                <Space size={8}>
                  <StopOutlined style={{ color: "#ff4d4f" }} />
                  <span>Lista de Exclusão de Sites (Blacklist)</span>
                </Space>
              }
            >
              <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14, color: "#8c8c8c" }}>
                Defina domínios onde o botão flutuante da extensão não deve aparecer (útil em editores gráficos como Figma/Canva, planilhas ou jogos web).
              </Paragraph>

              <Row gutter={8} style={{ marginBottom: 14 }}>
                <Col flex="auto">
                  <Input
                    placeholder="Ex: figma.com ou github.dev"
                    value={newDomainInput}
                    onChange={(e) => setNewDomainInput(e.target.value)}
                    onPressEnter={handleAddDomain}
                    style={{ backgroundColor: "#141414", borderColor: "#303030" }}
                  />
                </Col>
                <Col>
                  <Button 
                    type="primary" 
                    icon={<PlusOutlined />} 
                    onClick={handleAddDomain}
                  >
                    Adicionar
                  </Button>
                </Col>
              </Row>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minHeight: 32 }}>
                {ignoredDomains.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12, color: "#666" }}>
                    Nenhum site na lista de exclusão. A extensão está ativa em todas as páginas web.
                  </Text>
                ) : (
                  ignoredDomains.map((domain) => (
                    <Tag
                      key={domain}
                      closable
                      onClose={() => handleRemoveDomain(domain)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        backgroundColor: "#2a1215",
                        borderColor: "#5c2223",
                        color: "#ff7875"
                      }}
                    >
                      {domain}
                    </Tag>
                  ))
                )}
              </div>
            </Card>

            {/* Card 5: Full History */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "20px 24px" }}
              title={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <Space size={8}>
                    <HistoryOutlined style={{ color: "#1677ff" }} />
                    <span>Histórico de Correções Recentes</span>
                  </Space>
                  <Space size={8}>
                    <Button 
                      size="small" 
                      icon={<ReloadOutlined />} 
                      onClick={loadHistory} 
                      loading={loadingHistory}
                      style={{ backgroundColor: "#262626", borderColor: "#3a3a3a", color: "#d9d9d9" }}
                    >
                      Atualizar
                    </Button>
                    {historyList.length > 0 && (
                      <Popconfirm
                        title="Limpar Histórico"
                        description="Tem certeza que deseja apagar o histórico de correções?"
                        onConfirm={handleClearHistory}
                        okText="Sim, limpar"
                        cancelText="Cancelar"
                      >
                        <Button 
                          size="small" 
                          danger 
                          icon={<DeleteOutlined />}
                        >
                          Limpar Tudo
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                </div>
              }
            >
              {loadingHistory ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <Spin tip="Carregando histórico..." />
                </div>
              ) : historyList.length === 0 ? (
                <Empty 
                  image={Empty.PRESENTED_IMAGE_SIMPLE} 
                  description={<span style={{ color: "#666" }}>Nenhum histórico registrado ainda</span>} 
                />
              ) : (
                <Space direction="vertical" style={{ width: "100%" }} size={12}>
                  {historyList.map((item) => (
                    <div 
                      key={item.id}
                      style={{
                        padding: "12px 16px",
                        backgroundColor: "#141414",
                        border: "1px solid #2a2a2a",
                        borderRadius: 8
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <Space size={6}>
                          <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
                            {item.mode === "fix" || item.mode === "standard" ? "Correção" : item.mode}
                          </Tag>
                          <Tag style={{ fontSize: 10, margin: 0, backgroundColor: "#1f1f1f", borderColor: "#303030", color: "#8c8c8c" }}>
                            {item.modelUsed || "Groq"}
                          </Tag>
                          {item.latencyMs && (
                            <span style={{ fontSize: 10, color: "#666" }}>{item.latencyMs}ms</span>
                          )}
                        </Space>
                        <Space size={8}>
                          <span style={{ fontSize: 11, color: "#666" }}>
                            {new Date(item.timestamp).toLocaleString()}
                          </span>
                          <Button 
                            type="text" 
                            size="small" 
                            icon={<CopyOutlined />} 
                            onClick={() => {
                              navigator.clipboard.writeText(item.corrected)
                              messageApi.success("Texto copiado!")
                            }}
                          >
                            Copiar
                          </Button>
                        </Space>
                      </div>
                      
                      <div style={{ fontSize: 12, color: "#8c8c8c", textDecoration: "line-through", marginBottom: 4 }}>
                        {item.original}
                      </div>
                      <div style={{ fontSize: 13, color: "#52c41a" }}>
                        {item.corrected}
                      </div>
                    </div>
                  ))}
                </Space>
              )}
            </Card>

            {/* Bottom Actions Bar */}
            <Card 
              size="small" 
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030", marginBottom: 32 }}
              bodyStyle={{ padding: "14px 20px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text type="secondary" style={{ fontSize: 12, color: "#666" }}>
                  Modelo ativo configurado: <code style={{ color: "#1677ff" }}>{customModel.trim() || selectedModel}</code>
                </Text>
                <Space size={12}>
                  <Button onClick={openTestPage}>
                    Ir para Testes
                  </Button>
                  <Button 
                    type="primary" 
                    icon={<SaveOutlined />} 
                    loading={saving}
                    onClick={handleSave}
                    style={{ height: 36, padding: "0 20px" }}
                  >
                    Salvar Preferências
                  </Button>
                </Space>
              </div>
            </Card>

          </Space>
        </Content>
      </Layout>
    </ConfigProvider>
  )
}
