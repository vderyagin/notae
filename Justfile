build:
    mkdir -p dist
    bun build ./server.ts --target=bun --outfile ./dist/notæ
    chmod +x ./dist/notæ
