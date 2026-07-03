# Chrome Extension Install

## Development Install

1. Run `npm run configure`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select the `extension/` directory.

## Zip Install

```bash
npm run package:extension
```

The zip is written to:

```text
dist/reading-block-lark-extension.zip
```

For local testing, unzip it and load the unpacked folder in Chrome. Chrome does not install arbitrary unsigned zip files directly like the Chrome Web Store does.

## Updating

After changing `.env` or the Worker domain:

```bash
npm run configure
npm run package:extension
```

Then reload the extension in `chrome://extensions`.
