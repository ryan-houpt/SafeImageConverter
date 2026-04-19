# Safe Image Converter

Safe Image Converter is a Manifest V3 Chrome extension that adds image conversion actions to the right-click menu.

It lets you:
- save images as `PNG`, `JPG`, or `WebP`
- remove white or checkerboard preview backgrounds
- add white or black backgrounds to transparent images
- keep conversion local to the browser with no uploads

The same repository also contains the static GitHub Pages marketing site and privacy policy used for the Chrome Web Store listing.

## Live Links

- Chrome Web Store: <https://chromewebstore.google.com/detail/safe-image-converter/ahmpphfojckjpfkcbecphlpocabebppb>
- Site: <https://ryan-houpt.github.io/SafeImageConverter/>
- Privacy Policy: <https://ryan-houpt.github.io/SafeImageConverter/privacy.html>

## Features

- Right-click any image and save it as `PNG`, `JPG`, or `WebP`
- Remove white or checkerboard preview backgrounds
- Add white or black fills behind transparency
- Adjustable `JPG` / `WebP` quality
- Smarter download filenames based on the image, page, and source URL
- Local-only conversion using an offscreen document and canvas

## Privacy

Safe Image Converter does not upload images to a developer-controlled server.

The extension:
- uses Chrome context menus for image actions
- fetches the clicked image directly from the page you are on
- converts the result locally with canvas in an offscreen document
- stores only local preferences and short-lived source-candidate context

For the current privacy policy, see:
- <https://ryan-houpt.github.io/SafeImageConverter/privacy.html>

## Project Layout

- `manifest.json`: extension manifest
- `background.js`: context menu setup, fetch flow, download naming, and update handling
- `content.js`: page-side source candidate and filename hint capture
- `offscreen.js`: image conversion pipeline
- `popup.html`, `popup.js`, `popup.css`: extension popup
- `_locales/`: Chrome Web Store and UI localization strings
- `index.html`, `es/index.html`, `pt-br/index.html`, `privacy.html`: GitHub Pages site

## Local Development

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this repository root
5. Reload the extension after code changes
6. Reload any test pages when content scripts change

## Release Packaging

Package the extension files only, not the marketing site extras that are unrelated to the extension runtime.

Example:

```bash
zip -r safe-image-converter-1.2.0.zip \
  manifest.json background.js content.js offscreen.html offscreen.js \
  popup.html popup.js popup.css icons _locales
```

## License

This project is available under the MIT License. See [LICENSE](LICENSE).
