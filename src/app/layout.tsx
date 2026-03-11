// This is the root layout, it just passes children through
// The actual layout with html/body is in [locale]/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
