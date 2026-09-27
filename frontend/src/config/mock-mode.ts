export function isMockApiEnabled(): boolean {
  return (
    import.meta.env.MODE === "test" ||
    (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API !== "false")
  )
}
