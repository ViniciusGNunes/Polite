import React, { useState, useEffect } from "react"
import {
  ConfigProvider,
  Typography,
  Input,
  Button,
  Space,
  message,
  Tooltip,
  Row,
  Col,
  Tag,
  Popconfirm,
  theme
} from "antd"
import {
  KeyOutlined,
  SettingOutlined,
  ExperimentOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  EditOutlined,
  DeleteOutlined
} from "@ant-design/icons"
import "./styles.scss"
import politeLogoUrl from "url:../assets/icon.png"
import { localStorage, syncStorage } from "./utils/storage"
import { DEFAULT_FALLBACK_MODEL } from "./utils/models"

const { Text } = Typography

export default function IndexPopup() {
  const [apiKey, setApiKey] = useState("")
  const [activeModel, setActiveModel] = useState(DEFAULT_FALLBACK_MODEL)
  const [isEditingKey, setIsEditingKey] = useState(false)
  const [loading, setLoading] = useState(false)

  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    Promise.all([
      localStorage.get("groq_api_key"),
      syncStorage.get("groq_model")
    ]).then(([key, model]) => {
      if (key) {
        setApiKey(key as string)
      } else {
        setIsEditingKey(true)
      }
      if (model) setActiveModel(model as string)
    })
  }, [])

  const handleSave = async () => {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      messageApi.warning("Insira uma API Key válida.")
      return
    }
    setLoading(true)
    try {
      const result = await chrome.runtime.sendMessage({
        action: "test_key",
        apiKey: trimmedKey
      })

      if (result?.error) {
        messageApi.error(result.error)
        return
      }

      await localStorage.set("groq_api_key", trimmedKey)
      if (result?.modelUsed) {
        await syncStorage.set("groq_model", result.modelUsed)
        setActiveModel(result.modelUsed)
      }
      messageApi.success("API Key válida e salva com sucesso!")
      setIsEditingKey(false)
    } catch (err: any) {
      messageApi.error(err?.message || "Erro ao validar/salvar API Key.")
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveKey = async () => {
    try {
      await localStorage.remove("groq_api_key")
      setApiKey("")
      setIsEditingKey(true)
      messageApi.success("API Key removida!")
    } catch {
      messageApi.error("Erro ao remover chave.")
    }
  }

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage()
    } else {
      window.open(chrome.runtime.getURL("options.html"))
    }
  }

  const openTestPage = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/test.html") })
  }

  const isConnected = !!apiKey.trim() && !isEditingKey

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          colorBgContainer: "#1f1f1f",
          colorBgElevated: "#262626",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        }
      }}
    >
      {contextHolder}
      <div 
        style={{ 
          width: 320, 
          margin: 0,
          padding: "16px", 
          backgroundColor: "#141414", 
          boxSizing: "border-box",
          color: "#d9d9d9",
          overflow: "hidden"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                backgroundColor: "#111d2c",
                border: "1px solid #113560",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flexShrink: 0
              }}
            >
              <img src={politeLogoUrl} alt="Polite Logo" style={{ width: 28, height: 28 }} />
            </div>
            <Text strong style={{ fontSize: 18, color: "#ffffff", lineHeight: "22px" }}>
              Polite
            </Text>
          </div>

          <Tooltip title="Configurações">
            <Button 
              type="text" 
              icon={<SettingOutlined style={{ fontSize: 16, color: "#8c8c8c" }} />} 
              onClick={openSettings} 
              style={{ width: 32, height: 32, borderRadius: 6 }}
            />
          </Tooltip>
        </div>

        {isConnected ? (
          <div 
            style={{ 
              backgroundColor: "#111b26", 
              border: "1px solid #113560", 
              borderRadius: 8, 
              padding: "12px 14px", 
              marginBottom: 14 
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Space size={6}>
                <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 13 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#ffffff" }}>Pronto para uso</span>
              </Space>
              <Space size={8}>
                <Button 
                  type="link" 
                  size="small" 
                  icon={<EditOutlined style={{ fontSize: 11 }} />} 
                  onClick={() => setIsEditingKey(true)}
                  style={{ padding: 0, height: "auto", fontSize: 11, color: "#8c8c8c" }}
                >
                  Alterar
                </Button>
                <Popconfirm
                  title="Remover API Key?"
                  description="Deseja apagar a chave salva?"
                  onConfirm={handleRemoveKey}
                  okText="Sim"
                  cancelText="Não"
                  placement="bottomRight"
                >
                  <Button 
                    type="link" 
                    danger
                    size="small" 
                    icon={<DeleteOutlined style={{ fontSize: 11 }} />} 
                    style={{ padding: 0, height: "auto", fontSize: 11 }}
                  >
                    Remover
                  </Button>
                </Popconfirm>
              </Space>
            </div>

            <div style={{ fontSize: 11.5, color: "#8c8c8c", lineHeight: "18px" }}>
              Selecione qualquer texto e aperte <Tag color="blue" style={{ fontSize: 10, margin: "0 2px", padding: "0 4px" }}>Alt+C</Tag> para corrigir.
            </div>

            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #1b2d42", fontSize: 11, color: "#6b6b6b" }}>
              Modelo: <code style={{ color: "#1677ff" }}>{activeModel}</code>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <Text style={{ fontSize: 12, color: "#8c8c8c" }}>
                Insira sua API Key da Groq:
              </Text>
              {apiKey && (
                <Popconfirm
                  title="Remover API Key?"
                  onConfirm={handleRemoveKey}
                  okText="Sim"
                  cancelText="Não"
                  placement="bottomRight"
                >
                  <Button 
                    type="link" 
                    danger
                    size="small" 
                    icon={<DeleteOutlined style={{ fontSize: 11 }} />} 
                    style={{ padding: 0, height: "auto", fontSize: 11 }}
                  >
                    Remover
                  </Button>
                </Popconfirm>
              )}
            </div>
            <Input.Password
              prefix={<KeyOutlined style={{ color: "#8c8c8c" }} />}
              placeholder="gsk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030", marginBottom: 6 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 11 }}>
              <span style={{ color: "#7a7a7a" }}>Não tem uma chave?</span>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  if (typeof chrome !== "undefined" && chrome?.tabs?.create) {
                    chrome.tabs.create({ url: "https://console.groq.com/keys" })
                  } else {
                    window.open("https://console.groq.com/keys", "_blank")
                  }
                }}
                style={{ color: "#1677ff", textDecoration: "none", cursor: "pointer" }}
              >
                Criar grátis no Groq Console ↗
              </a>
            </div>
            <Row gutter={8}>
              <Col flex="auto">
                <Button 
                  type="primary" 
                  icon={<CheckOutlined />} 
                  loading={loading}
                  onClick={handleSave}
                  block
                  size="middle"
                >
                  Salvar Chave
                </Button>
              </Col>
              {apiKey && (
                <Col>
                  <Button 
                    size="middle"
                    onClick={() => setIsEditingKey(false)}
                    style={{ backgroundColor: "#1f1f1f", borderColor: "#303030", color: "#8c8c8c" }}
                  >
                    Cancelar
                  </Button>
                </Col>
              )}
            </Row>
          </div>
        )}

        <Row gutter={8}>
          <Col span={12}>
            <Button 
              icon={<ExperimentOutlined />}
              onClick={openTestPage}
              block
              size="small"
              style={{
                backgroundColor: "#1f1f1f",
                borderColor: "#303030",
                color: "#d9d9d9",
                height: 32,
                fontSize: 12
              }}
            >
              Playground
            </Button>
          </Col>
          <Col span={12}>
            <Button 
              icon={<SettingOutlined />}
              onClick={openSettings}
              block
              size="small"
              style={{
                backgroundColor: "#1f1f1f",
                borderColor: "#303030",
                color: "#d9d9d9",
                height: 32,
                fontSize: 12
              }}
            >
              Configurações
            </Button>
          </Col>
        </Row>
      </div>
    </ConfigProvider>
  )
}
