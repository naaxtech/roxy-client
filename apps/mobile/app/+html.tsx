import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Web-only HTML shell (Expo Router static rendering). Native is untouched.
 * Adds the viewport/meta defaults plus subtle overlay scrollbars so the app
 * column doesn't ship a bright default scrollbar strip on dark theme.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <title>Roxy</title>
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: scrollbarStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const scrollbarStyles = `
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(140, 120, 160, 0.35) transparent;
}
*::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: rgba(140, 120, 160, 0.35);
  border-radius: 4px;
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(140, 120, 160, 0.55);
}
`;
