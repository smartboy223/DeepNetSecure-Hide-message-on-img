# 🔐 DeepNetSecure

Hide and recover encrypted messages inside PNG images with a local web app. DeepNetSecure combines AES encryption, Reed-Solomon error correction, SHA-256 integrity checks, texture-priority LSB embedding, and a bundled Keras cover-image suitability model.

## ✨ What it does

- 🖼️ Encodes a secret message into a lossless PNG image.
- 🔑 Protects the message with a passphrase-based AES workflow.
- 🧩 Adds error correction so minor bit issues can be repaired.
- ✅ Verifies recovered messages with a SHA-256 integrity check.
- 🧠 Uses the included `cnn_model/embed_suitability.keras` model to score cover-image suitability, so users do not need to retrain before running the project.
- 🖥️ Runs locally with a React frontend, Express backend, and Python ML inference.

## 📦 Included model

The repository includes the trained Keras model and metadata:

- `cnn_model/embed_suitability.keras`
- `cnn_model/evaluation_metrics.json`
- `cnn_model/class_names.json`
- `cnn_model/labels.json`
- `cnn_model/embed_mlp.joblib` fallback model

The app automatically tries the Keras model first. If TensorFlow is unavailable, it falls back to the sklearn MLP model, then to a heuristic.

## 🧰 Requirements

- Node.js 18 or newer
- Python 3.10 to 3.12 recommended for TensorFlow
- npm
- About 2 GB of free disk space for dependencies

## 🚀 Quick start

```bash
npm install
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
npm run build
npm start
```

Open:

```text
http://localhost:4006
```

Windows users can also run:

```bat
run.bat
```

## 🧪 Development mode

Start the backend:

```bash
npm start
```

In another terminal, start the frontend dev server:

```bash
npm run dev
```

The Vite dev server proxies `/api` requests to the backend on port `4006`.

## 🕹️ How to use

1. Open the app and choose **Encode**.
2. Select a cover image. PNG is recommended for the final output.
3. Enter the secret message and a strong passphrase.
4. Review the ML cover assessment and capacity details.
5. Encode and download the generated stego PNG.
6. Choose **Decode**.
7. Upload the stego PNG and enter the same passphrase.
8. Extract the message and check the integrity result.

## ⚠️ Important notes

- Use lossless PNG output. JPEG, WebP conversion, cropping, resizing, and chat-app recompression can destroy hidden bits.
- Keep the passphrase. The app cannot recover a message without it.
- The ML model is advisory. It helps estimate cover suitability, but the encode/decode pipeline remains deterministic.
- The `dataset/` folder is intentionally ignored because the trained model is already included.

## 🧪 Validation commands

```bash
npm run lint
npm run build
python backend/check_ml_env.py
```

## 🗂️ Project structure

```text
backend/       Express server and Python ML scripts
cnn_model/     Bundled trained Keras model, fallback model, and metrics
frontend/      React + Vite user interface
run.bat        Windows one-click build and run helper
```
