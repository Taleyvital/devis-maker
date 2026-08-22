"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage, ChatResponse, DevisData, DevisUpdate } from "@/lib/types";

interface ChatPanelProps {
  devis: DevisData;
  onUpdate: (update: DevisUpdate) => DevisData;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onDevisRestore: (devis: DevisData) => void;
}

export const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Bonjour ! Décrivez votre devis en langage naturel et je remplirai tout automatiquement.\n\nExemple :\n« Devis pour Mr Koffi, aménagement cuisine villa Cocody, 4 meubles bas MDF à 85 000 FCFA, 2 meubles hauts à 60 000 FCFA, main d'œuvre 120 000 FCFA »",
};

interface Session {
  id: string;
  titre: string;
  updated_at: string;
}

function fmtSessionDate(d: string) {
  const da  = new Date(d);
  const now = new Date();
  const diff = Math.floor((now.getTime() - da.getTime()) / 1000 / 60);
  if (diff < 1)   return "À l'instant";
  if (diff < 60)  return `Il y a ${diff} min`;
  if (diff < 1440) return `Il y a ${Math.floor(diff / 60)} h`;
  return da.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export default function ChatPanel({ devis, onUpdate, messages, setMessages, onDevisRestore }: ChatPanelProps) {
  const [input, setInput]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [showHistory, setShowHistory]   = useState(false);
  const [sessions, setSessions]         = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions]   = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  useEffect(() => { autoGrow(); }, [input, autoGrow]);

  // Charger la liste des sessions
  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const r = await fetch("/api/chat-sessions");
      const d = await r.json();
      setSessions(Array.isArray(d) ? d : []);
    } finally {
      setLoadingSessions(false);
    }
  };

  // Créer ou obtenir la session courante
  const ensureSession = async (firstUserMessage: string): Promise<string | null> => {
    if (currentSessionId) return currentSessionId;
    const titre = firstUserMessage.slice(0, 60) + (firstUserMessage.length > 60 ? "…" : "");
    const r = await fetch("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre }),
    });
    const session = await r.json().catch(() => null);
    if (!r.ok || !session || !session.id) {
      // Could not create session (likely unauthorized). Do not return an id.
      console.error("Failed to create chat session", session);
      return null;
    }
    setCurrentSessionId(session.id);
    return session.id;
  };

  // Sauvegarder des messages + snapshot du devis dans la session
  const saveMessages = async (sessionId: string, msgs: ChatMessage[], devisSnapshot?: DevisData) => {
    await fetch(`/api/chat-sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, devis_data: devisSnapshot ?? null }),
    });
  };

  // Charger une session (messages + devis associé)
  const loadSession = async (session: Session) => {
    const r = await fetch(`/api/chat-sessions/${session.id}/messages`);
    const data = await r.json();
    const msgs = data.messages ?? data; // rétrocompat si ancien format
    if (Array.isArray(msgs) && msgs.length > 0) {
      setMessages(msgs.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })));
      setCurrentSessionId(session.id);
    }
    // Restaurer le devis associé à cette session
    if (data.devis_data) {
      onDevisRestore(data.devis_data);
    }
    setShowHistory(false);
  };

  // Nouvelle discussion
  const newSession = () => {
    setMessages([WELCOME_MESSAGE]);
    setCurrentSessionId(null);
    setInput("");
    setShowHistory(false);
  };

  // Supprimer une session
  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/chat-sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) newSession();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, currentDevis: devis }),
      });
      const data: ChatResponse = await res.json();
      // Appliquer la mise à jour ET récupérer le nouveau devis immédiatement
      const updatedDevis = data.update ? onUpdate(data.update) : devis;

      const assistantMsg: ChatMessage = { role: "assistant", content: data.message };
      setMessages((prev) => [...prev, assistantMsg]);

      // Sauvegarder avec le devis à jour (pas l'ancien état stale)
      const sessionId = await ensureSession(text);
      if (sessionId) {
        saveMessages(sessionId, [userMsg, assistantMsg], updatedDevis);
      } else {
        // If session couldn't be created (e.g. unauthenticated), log and skip saving.
        console.warn("Session not available — messages not saved.");
      }

    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Erreur de connexion. Vérifiez la clé API Groq." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (_e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Envoi uniquement via le bouton ➤ — la touche Entrée insère un saut de ligne.
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">

      {/* Panneau historique */}
      {showHistory && (
        <div className="absolute inset-0 z-20 flex flex-col bg-app-panel">
          {/* Header historique */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border flex-shrink-0">
            <span className="text-[10px] font-bold tracking-[2px] uppercase text-gold">Historique</span>
            <div className="flex gap-2">
              <button
                onClick={newSession}
                className="px-3 py-1.5 text-[10px] font-bold tracking-[1px] uppercase border border-gold text-gold bg-transparent cursor-pointer hover:bg-gold hover:text-black transition-all"
              >
                + Nouvelle
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="text-app-muted hover:text-app-text text-xl bg-transparent border-none cursor-pointer p-1 leading-none"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Liste */}
          <div className="flex-1 overflow-y-auto">
            {loadingSessions && (
              <div className="flex justify-center py-8">
                <span className="text-app-muted text-[12px]">Chargement…</span>
              </div>
            )}
            {!loadingSessions && sessions.length === 0 && (
              <div className="text-app-muted text-[12px] text-center py-8 px-4">
                Aucune discussion sauvegardée.<br />
                <span className="text-[11px]">Vos conversations sont enregistrées automatiquement.</span>
              </div>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s)}
                className={`flex items-center gap-3 px-4 py-3 border-b border-app-border/50 cursor-pointer hover:bg-app-bg transition-colors ${currentSessionId === s.id ? "bg-app-bg border-l-2 border-l-gold" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-app-text text-[12px] truncate">{s.titre}</div>
                  <div className="text-app-muted text-[10px] mt-0.5">{fmtSessionDate(s.updated_at)}</div>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="text-app-muted hover:text-red-400 text-[16px] leading-none bg-transparent border-none cursor-pointer p-1 flex-shrink-0 transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Barre supérieure du chat */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border flex-shrink-0">
        <span className="text-[9px] font-bold tracking-[2px] uppercase text-gold">
          ✦ Chat IA{currentSessionId ? " · En cours" : ""}
        </span>
        <div className="flex gap-1">
          <button
            onClick={newSession}
            title="Nouvelle discussion"
            className="text-app-muted hover:text-gold text-[18px] leading-none bg-transparent border-none cursor-pointer px-2 py-1 transition-colors"
          >
            ✎
          </button>
          <button
            onClick={() => { setShowHistory(true); loadSessions(); }}
            title="Historique"
            className="text-app-muted hover:text-gold text-[16px] leading-none bg-transparent border-none cursor-pointer px-2 py-1 transition-colors"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[90%] sm:max-w-[88%] px-4 py-3 text-[14px] sm:text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-gold text-white"
                  : "bg-app-input border border-app-border text-app-text"
              }`}
            >
              {m.role === "assistant" && (
                <div className="text-[9px] font-bold tracking-widest text-gold mb-1.5 uppercase">
                  IA Tutto Legno
                </div>
              )}
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-app-input border border-app-border px-4 py-3">
              <div className="flex gap-1.5 items-center">
                {[0, 150, 300].map((delay) => (
                  <span key={delay} className="w-2 h-2 bg-gold rounded-full animate-bounce"
                    style={{ animationDelay: `${delay}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-app-border flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-app-input border border-app-border text-app-text font-montserrat text-[14px] sm:text-[12px] px-3 py-2.5 outline-none focus:border-gold transition-colors resize-none overflow-hidden leading-relaxed"
            rows={1}
            style={{ minHeight: "44px" }}
            placeholder="Décrivez votre devis..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-gold text-white flex-shrink-0 flex items-center justify-center cursor-pointer disabled:opacity-40 hover:opacity-85 transition-opacity border-none"
            style={{ width: "44px", height: "44px", fontSize: "18px" }}
            aria-label="Envoyer"
          >
            ➤
          </button>
        </div>
        <div className="hidden sm:block text-[10px] text-app-muted mt-1.5">
          Cliquez sur ➤ pour envoyer · Entrée pour une nouvelle ligne
        </div>
      </div>
    </div>
  );
}
