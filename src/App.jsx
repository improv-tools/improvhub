import React, { useState, useEffect, useRef } from "react";
import LISTS from "./lists";

const TITLE_KEY = "__TITLE__";
const LIST_KEYS = [...Object.keys(LISTS), TITLE_KEY];

const TITLE_PATTERNS = [
  // Single noun
  ({ noun }) => `The ${noun}`,

  // Adjective + noun
  ({ adj, noun }) => `The ${adj} ${noun}`,

  // Two nouns
  ({ noun1, noun2 }) => `The ${noun1} of the ${noun2}`,

  // Adjective + noun of noun
  ({ adj, noun1, noun2 }) => `The ${adj} ${noun1} of the ${noun2}`,

  // Noun of adjective noun
  ({ noun1, adj, noun2 }) => `The ${noun1} of the ${adj} ${noun2}`,

  // Adjective noun in/of location
  ({ adj, noun, location }) => `The ${adj} ${noun} in the ${location}`,
  ({ adj, noun, location }) => `The ${adj} ${noun} of ${location}`,

  // Two adjectives
  ({ adj1, adj2, noun }) => `The ${adj1} and ${adj2} ${noun}`,
  ({ adj1, adj2, noun1, noun2 }) => `The ${adj1} ${noun1} of the ${adj2} ${noun2}`,
  ({ adj1, adj2, noun, location }) => `The ${adj1} and ${adj2} ${noun} of ${location}`,

  // Genre or location focused
  ({ genre, location }) => `A ${genre} in ${location}`,
  ({ noun, location }) => `The ${noun} in the ${location}`,
  ({ noun, location }) => `The ${noun} of ${location}`,

  // Plural pairings
  ({ noun1, noun2 }) => `${noun1}s and ${noun2}s`,
  ({ adj, noun1, noun2 }) => `The ${adj} ${noun1}s and ${noun2}s`,
  ({ adj, noun1, noun2 }) => `${noun1}s and the ${adj} ${noun2}`,
];

function generateStoryTitle() {
  const adjectiveList = LISTS["Adjectives"] || [];
  const nounList = [
    ...(LISTS["More Nouns"] || []),
    ...(LISTS["Polysenous"] || []),
  ];
  const locationList = LISTS["Locations"] || [];
  const genreList = LISTS["Genres"] || [];

  const adj = adjectiveList.length > 0 ? randomText(adjectiveList) : "";
  const adj1 = adjectiveList.length > 0 ? randomText(adjectiveList) : "";
  const adj2 = adjectiveList.length > 0 ? randomText(adjectiveList) : "";

  const noun = nounList.length > 0 ? randomText(nounList) : "";
  const noun1 = nounList.length > 0 ? randomText(nounList) : "";
  const noun2 = nounList.length > 0 ? randomText(nounList) : "";

  const location = locationList.length > 0 ? randomText(locationList) : "";
  const genre = genreList.length > 0 ? randomText(genreList) : "";

  const pattern = TITLE_PATTERNS[Math.floor(Math.random() * TITLE_PATTERNS.length)];
  return { text: pattern({ adj, adj1, adj2, noun, noun1, noun2, location, genre }) };
}

function randomText(list) {
  return list[Math.floor(Math.random() * list.length)].text;
}

export default function App() {
  const [activeKey, setActiveKey] = useState(LIST_KEYS[0]);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [showDefinition, setShowDefinition] = useState(false);

  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) containerRef.current.focus();
  }, []);

  const getRandomPrompt = () => {
    if (activeKey === TITLE_KEY) {
      return generateStoryTitle();
    }
    const list = LISTS[activeKey];
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  };

  useEffect(() => {
    setCurrentPrompt(getRandomPrompt());
    setShowDefinition(false);
  }, [activeKey]);

  const handleClick = () => {
    setCurrentPrompt(getRandomPrompt());
    setShowDefinition(false);
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="button"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
      style={{
        height: "100dvh",
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#000000",
        color: "#ffffff",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        boxSizing: "border-box",
        outline: "none",
      }}
    >
      <div
        style={{
          backgroundColor: "#111",
          padding: "0.75rem 1rem",
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          justifyContent: "center",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {LIST_KEYS.map((key) => (
          <button
            key={key}
            style={{
              padding: "0.45rem 1rem",
              borderRadius: "0.25rem",
              border: "1px solid #fff",
              backgroundColor: activeKey === key ? "#fff" : "#000",
              color: activeKey === key ? "#000" : "#fff",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.95rem",
              userSelect: "none",
              transition: "background-color 0.2s, color 0.2s",
              fontFamily: "inherit",
            }}
            aria-pressed={activeKey === key}
            onClick={(e) => {
              e.stopPropagation();
              setActiveKey(key);
            }}
          >
            {key === TITLE_KEY ? "Title" : key}
          </button>
        ))}
      </div>

      <main
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "0.5rem",
          textAlign: "center",
          position: "relative",
        }}
      >
        {currentPrompt ? (
          <>
            <div>
              <h1
                style={{
                  fontSize: "2rem",
                  fontWeight: "600",
                  color: "#ffffff",
                  maxWidth: "40rem",
                  marginBottom: "0",
                }}
              >
                {currentPrompt.text}
                {(currentPrompt.definition || currentPrompt.definitions) && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDefinition(!showDefinition);
                    }}
                    style={{
                      fontSize: "1rem",
                      color: "#cccccc",
                      cursor: "pointer",
                      marginLeft: "0.5rem",
                    }}
                    title="Show definition"
                  >
                    ⓘ
                  </span>
                )}
              </h1>

              <div style={{ minHeight: "1.25rem", marginTop: "0.1rem" }}>
                {showDefinition && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "#cccccc",
                      maxWidth: "32rem",
                      margin: 0,
                    }}
                  >
                    {currentPrompt.definition ||
                      (currentPrompt.definitions &&
                        currentPrompt.definitions.join("; "))}
                  </p>
                )}
              </div>

              {currentPrompt.description && (
                <p
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "1rem",
                    fontStyle: "italic",
                    color: "#aaaaaa",
                    maxWidth: "34rem",
                  }}
                >
                  {currentPrompt.description}
                </p>
              )}

              {currentPrompt.labels && currentPrompt.labels.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    marginTop: "0.5rem",
                    marginBottom: "0.25rem",
                  }}
                >
                  {currentPrompt.labels.map((label) => (
                    <span
                      key={label}
                      style={{
                        background: "#333",
                        color: "#fff",
                        borderRadius: "999px",
                        padding: "0.2em 0.9em",
                        fontSize: "0.85em",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        userSelect: "text",
                        boxShadow: "0 1px 2px rgba(255,255,255,0.1)",
                        fontFamily: "inherit",
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <p
              style={{
                position: "absolute",
                bottom: "1rem",
                fontSize: "0.75rem",
                color: "#888888",
              }}
            >
              (Click anywhere or press Enter/Space to see another prompt)
            </p>
          </>
        ) : (
          <p style={{ color: "#bbbbbb", marginTop: "1.5rem" }}>
            No prompts available for this category.
          </p>
        )}
      </main>
    </div>
  );
}
