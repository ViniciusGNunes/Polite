import React, { useState, useEffect } from "react";
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
  Row,
  Col,
  Tag,
  message,
  theme,
  Spin,
  Empty,
  Popconfirm,
} from "antd";
import {
  KeyOutlined,
  ExperimentOutlined,
  SaveOutlined,
  ApiOutlined,
  LinkOutlined,
  ControlOutlined,
  ReloadOutlined,
  StopOutlined,
  HistoryOutlined,
  DeleteOutlined,
  CopyOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import "./styles.scss";
import politeLogoUrl from "url:../assets/icon.png";
import { localStorage, syncStorage } from "./utils/storage";
import {
  DEPRECATED_MODELS,
  DEFAULT_FALLBACK_MODEL,
  RECOMMENDED_MODELS,
  isKnownModel,
  isChatEligibleModel,
} from "./utils/models";

const { Header, Content } = Layout;
const { Title, Text, Paragraph, Link } = Typography;

export default function OptionsPage() {
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("openai/gpt-oss-20b");
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([]);
  const [newDomainInput, setNewDomainInput] = useState("");
  const [domainError, setDomainError] = useState("");

  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [messageApi, contextHolder] = message.useMessage();

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      let historyData: any[] = [];
      const raw = await localStorage.get("groq_correction_history");
      if (raw) {
        historyData =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
      }

      setHistoryList(Array.isArray(historyData) ? historyData : []);
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
      setHistoryList([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    const handleStorageChange = (changes: any, areaName: string) => {
      if (areaName === "local" && changes.groq_correction_history) {
        const newRaw = changes.groq_correction_history.newValue;
        if (newRaw) {
          const parsed =
            typeof newRaw === "string"
              ? JSON.parse(newRaw)
              : Array.isArray(newRaw)
                ? newRaw
                : [];
          setHistoryList(Array.isArray(parsed) ? parsed : []);
        } else {
          setHistoryList([]);
        }
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  useEffect(() => {
    Promise.all([
      localStorage.get("groq_api_key"),
      syncStorage.get("groq_model"),
      syncStorage.get("groq_available_models"),
      syncStorage.get("ignored_domains"),
    ]).then(([key, model, cachedModels, rawDomains]) => {
      if (key) setApiKey(key as string);

      let discovered: string[] = [];
      if (cachedModels) {
        try {
          const parsed = JSON.parse(cachedModels as string);
          if (Array.isArray(parsed)) {
            discovered = parsed.filter(
              (id: string) => isChatEligibleModel(id) && !isKnownModel(id),
            );
          }
        } catch (e) {}
      }
      setDiscoveredModels(discovered);

      const savedModel = (model as string) || DEFAULT_FALLBACK_MODEL;
      setSelectedModel(
        DEPRECATED_MODELS.includes(savedModel)
          ? DEFAULT_FALLBACK_MODEL
          : savedModel,
      );

      if (rawDomains) {
        try {
          const parsed =
            typeof rawDomains === "string"
              ? JSON.parse(rawDomains)
              : rawDomains;
          if (Array.isArray(parsed)) setIgnoredDomains(parsed);
        } catch (e) {}
      }
    });

    loadHistory();
  }, []);

  const handleFetchAccountModels = async () => {
    if (!apiKey.trim()) {
      messageApi.warning(
        "Insira sua API Key primeiro para listar os modelos da sua conta.",
      );
      return;
    }

    setFetchingModels(true);
    try {
      const res = await chrome.runtime.sendMessage({
        action: "get_models",
        apiKey: apiKey.trim(),
      });

      if (res.error) {
        messageApi.error("Erro ao listar modelos: " + res.error);
      } else if (res.models && res.models.length > 0) {
        const extraModels = res.models.filter(
          (id: string) => isChatEligibleModel(id) && !isKnownModel(id),
        );
        setDiscoveredModels(extraModels);
        messageApi.success(
          `${res.models.length} modelos ativos encontrados na sua conta Groq!`,
        );
      }
    } catch (err: any) {
      messageApi.error("Erro de comunicação: " + err.message);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const promises = [
        syncStorage.set("groq_model", selectedModel),
        syncStorage.set("ignored_domains", JSON.stringify(ignoredDomains)),
      ];

      if (apiKey.trim()) {
        promises.push(localStorage.set("groq_api_key", apiKey.trim()));
      } else {
        messageApi.warning("Aviso: Nenhuma API Key foi preenchida.");
      }

      await Promise.all(promises);
      messageApi.success("Configurações salvas com sucesso!");
    } catch (err) {
      console.error(err);
      messageApi.error("Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      messageApi.warning("Insira uma chave antes de testar.");
      return;
    }

    setTestingKey(true);
    setTestResult(null);

    try {
      const response = await chrome.runtime.sendMessage({
        action: "test_key",
        apiKey: apiKey.trim(),
        model: selectedModel,
      });

      if (response.error) {
        setTestResult({ success: false, message: response.error });
        messageApi.error("Falha no teste da API Key.");
      } else {
        setTestResult({
          success: true,
          message: `Conexão bem sucedida com a Groq! Modelo operacional utilizado: ${response.modelUsed}`,
        });
        if (response.modelUsed && response.modelUsed !== selectedModel) {
          setSelectedModel(response.modelUsed);
        }
        await localStorage.set("groq_api_key", apiKey.trim());
        messageApi.success("API Key válida e salva automaticamente!");
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || "Erro desconhecido ao testar conexão.",
      });
      messageApi.error("Falha ao comunicar com o serviço em background.");
    } finally {
      setTestingKey(false);
    }
  };

  const handleRemoveKey = async () => {
    try {
      await localStorage.remove("groq_api_key");
      setApiKey("");
      setTestResult(null);
      messageApi.success("API Key removida com sucesso!");
    } catch {
      messageApi.error("Erro ao remover API Key.");
    }
  };

  const DOMAIN_PATTERN =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

  const handleAddDomain = () => {
    const domain = newDomainInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!domain) return;
    if (!DOMAIN_PATTERN.test(domain)) {
      setDomainError("Digite um domínio válido, ex: figma.com");
      return;
    }
    if (ignoredDomains.includes(domain)) {
      setDomainError("Este domínio já está na lista.");
      return;
    }
    const updated = [...ignoredDomains, domain];
    setIgnoredDomains(updated);
    setNewDomainInput("");
    setDomainError("");
    syncStorage.set("ignored_domains", JSON.stringify(updated));
    messageApi.success(`Domínio ${domain} adicionado à lista de exclusão.`);
  };

  const handleRemoveDomain = (domainToRemove: string) => {
    const updated = ignoredDomains.filter((d) => d !== domainToRemove);
    setIgnoredDomains(updated);
    syncStorage.set("ignored_domains", JSON.stringify(updated));
    messageApi.info(`Domínio ${domainToRemove} removido.`);
  };

  const handleClearHistory = async () => {
    try {
      await localStorage.set("groq_correction_history", []);
      setHistoryList([]);
      messageApi.success("Histórico de correções limpo com sucesso!");
    } catch {
      messageApi.error("Erro ao limpar histórico.");
    }
  };

  const openTestPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/test.html") });
  };

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
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        },
      }}
    >
      {contextHolder}
      <Layout className="polite-page">
        <Header className="polite-page-header">
          <div className="polite-page-brand">
            <div className="polite-page-logo">
              <img
                src={politeLogoUrl}
                alt="Polite Logo"
                style={{ width: 40, height: 40 }}
              />
            </div>
            <div>
              <Title level={4} className="polite-page-title">
                Configurações da Extensão
              </Title>
              <Text className="polite-page-subtitle">
                Personalize os modelos de IA da Groq e listas de exclusão
              </Text>
            </div>
          </div>

          <Space size={12}>
            <Button
              icon={<ExperimentOutlined />}
              onClick={openTestPage}
              className="polite-nav-button"
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

        <Content className="polite-page-content">
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Card
              className="polite-panel"
              styles={{ body: { padding: "20px 24px" } }}
              title={
                <Space size={8}>
                  <KeyOutlined style={{ color: "#1677ff" }} />
                  <span>Autenticação & Chave da API Groq</span>
                </Space>
              }
            >
              <Paragraph
                type="secondary"
                style={{ fontSize: 13, marginBottom: 14, color: "#8c8c8c" }}
              >
                Obtenha sua chave no{" "}
                <Link
                  href="https://console.groq.com/keys"
                  target="_blank"
                  style={{ color: "#1677ff" }}
                >
                  Groq Console <LinkOutlined />
                </Link>
                .
              </Paragraph>

              <Row gutter={12} align="middle">
                <Col flex="auto">
                  <Input.Password
                    prefix={<KeyOutlined style={{ color: "#8c8c8c" }} />}
                    placeholder="gsk_..."
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestResult(null);
                    }}
                    style={{
                      height: 40,
                      backgroundColor: "#141414",
                      borderColor: "#303030",
                      fontSize: 13,
                    }}
                  />
                </Col>
                <Col>
                  <Button
                    icon={<ApiOutlined />}
                    loading={testingKey}
                    onClick={handleTestKey}
                    className="polite-nav-button"
                    style={{ height: 40, padding: "0 18px" }}
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
                    message={
                      testResult.success
                        ? "Chave Validada com Sucesso"
                        : "Falha na Verificação"
                    }
                    description={testResult.message}
                  />
                </div>
              )}
            </Card>

            <Card
              className="polite-panel"
              styles={{ body: { padding: "20px 24px" } }}
              title={
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                  }}
                >
                  <Space size={8}>
                    <ControlOutlined style={{ color: "#1677ff" }} />
                    <span>Modelo Ativo</span>
                  </Space>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={fetchingModels}
                    onClick={handleFetchAccountModels}
                    className="polite-nav-button"
                    style={{ fontSize: 12 }}
                  >
                    Descobrir Modelos da Conta
                  </Button>
                </div>
              }
            >
              <Paragraph
                type="secondary"
                style={{ fontSize: 13, marginBottom: 16, color: "#8c8c8c" }}
              >
                Selecione um dos modelos de produção ativos recomendados abaixo.
              </Paragraph>

              <Radio.Group
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ width: "100%" }}
              >
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {RECOMMENDED_MODELS.map((model) => (
                    <Card
                      key={model.value}
                      size="small"
                      hoverable
                      onClick={() => setSelectedModel(model.value)}
                      style={{
                        borderColor:
                          selectedModel === model.value ? "#1677ff" : "#303030",
                        backgroundColor:
                          selectedModel === model.value ? "#111b26" : "#141414",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      styles={{ body: { padding: "12px 16px" } }}
                    >
                      <Radio value={model.value}>
                        <Text
                          strong
                          style={{
                            fontSize: 13,
                            marginLeft: 4,
                            color: "#ffffff",
                          }}
                        >
                          {model.title}
                        </Text>
                        <code
                          style={{
                            fontSize: 11,
                            marginLeft: 8,
                            color: "#8c8c8c",
                          }}
                        >
                          ({model.value})
                        </code>
                      </Radio>
                    </Card>
                  ))}

                  {discoveredModels.length > 0 && (
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 14,
                        borderTop: "1px dashed #303030",
                      }}
                    >
                      <Text
                        strong
                        style={{
                          fontSize: 12,
                          color: "#d9d9d9",
                          display: "block",
                          marginBottom: 8,
                        }}
                      >
                        Outros modelos detectados na sua conta:
                      </Text>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                      >
                        {discoveredModels.map((id) => (
                          <Tag.CheckableTag
                            key={id}
                            checked={selectedModel === id}
                            onChange={(checked) => {
                              if (checked) setSelectedModel(id);
                            }}
                            style={{
                              padding: "4px 10px",
                              fontSize: 12,
                              border: "1px solid #303030",
                              backgroundColor:
                                selectedModel === id ? "#1677ff" : "#1a1a1a",
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
            </Card>

            <Card
              className="polite-panel"
              styles={{ body: { padding: "20px 24px" } }}
              title={
                <Space size={8}>
                  <StopOutlined style={{ color: "#ff4d4f" }} />
                  <span>Lista de Exclusão de Sites (Blacklist)</span>
                </Space>
              }
            >
              <Paragraph
                type="secondary"
                style={{ fontSize: 13, marginBottom: 14, color: "#8c8c8c" }}
              >
                Defina domínios onde a extensão não deve funcionarqua.
              </Paragraph>

              <Row gutter={8} style={{ marginBottom: domainError ? 6 : 14 }}>
                <Col flex="auto">
                  <Input
                    placeholder="Ex: figma.com ou github.dev"
                    value={newDomainInput}
                    status={domainError ? "error" : ""}
                    onChange={(e) => {
                      setNewDomainInput(e.target.value);
                      if (domainError) setDomainError("");
                    }}
                    onPressEnter={handleAddDomain}
                    style={{
                      backgroundColor: "#141414",
                      borderColor: "#303030",
                    }}
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
              {domainError && (
                <Text
                  type="danger"
                  style={{ fontSize: 12, display: "block", marginBottom: 14 }}
                >
                  {domainError}
                </Text>
              )}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  minHeight: 32,
                }}
              >
                {ignoredDomains.length === 0 ? (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, color: "#666" }}
                  >
                    Nenhum site na lista de exclusão. A extensão está ativa em
                    todas as páginas web.
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
                        color: "#ff7875",
                      }}
                    >
                      {domain}
                    </Tag>
                  ))
                )}
              </div>
            </Card>

            <Card
              className="polite-panel"
              styles={{ body: { padding: "20px 24px" } }}
              title={
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                  }}
                >
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
                      className="polite-nav-button"
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
                        <Button size="small" danger icon={<DeleteOutlined />}>
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
                  <Spin>
                    <div style={{ padding: "4px 0", minWidth: 160 }} />
                  </Spin>
                  <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 8 }}>
                    Carregando histórico...
                  </div>
                </div>
              ) : historyList.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ color: "#666" }}>
                      Nenhum histórico registrado ainda
                    </span>
                  }
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
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 6,
                        }}
                      >
                        <Space size={6}>
                          <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
                            {item.mode || "Corrigir"}
                          </Tag>
                          <Tag
                            style={{
                              fontSize: 10,
                              margin: 0,
                              backgroundColor: "#1f1f1f",
                              borderColor: "#303030",
                              color: "#8c8c8c",
                            }}
                          >
                            {item.modelUsed || "Groq"}
                          </Tag>
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
                              navigator.clipboard.writeText(item.corrected);
                              messageApi.success("Texto copiado!");
                            }}
                          >
                            Copiar
                          </Button>
                        </Space>
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          color: "#8c8c8c",
                          textDecoration: "line-through",
                          marginBottom: 4,
                        }}
                      >
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

            <Card
              size="small"
              className="polite-panel"
              style={{ marginBottom: 32 }}
              styles={{ body: { padding: "14px 20px" } }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text type="secondary" style={{ fontSize: 12, color: "#666" }}>
                  Modelo ativo configurado:{" "}
                  <code style={{ color: "#1677ff" }}>{selectedModel}</code>
                </Text>
                <Space size={12}>
                  <Button onClick={openTestPage}>Ir para Testes</Button>
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
  );
}
