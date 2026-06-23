##### DeepNetSecure - Requirements

##### ⚠️ CRITICAL: What You Need

**IMPORTANT:** DeepNetSecure requires **BOTH Node.js AND Python** to run properly!

1. ##### Node.js v16 or higher (for frontend + backend server)

   * ##### Download: https://nodejs.org/
   * ##### Verify: open command prompt and type "node --version"

2. ##### Python 3.8 or higher (for ML model analysis)

   * ##### Download: https://www.python.org/downloads/
   * ##### **IMPORTANT:** Check "Add Python to PATH" during installation
   * ##### Verify: open command prompt and type "python --version"

3. ##### TensorFlow and ML Libraries (required for image analysis)

   * ##### Run these commands in Command Prompt:
   ```
   pip install --upgrade pip
   pip install tensorflow==2.13.0
   pip install opencv-python==4.8.0.74
   pip install numpy==1.24.3
   pip install scikit-learn==1.3.0
   pip install pillow==10.0.0
   ```

4. ##### About 3GB free disk space (2GB for project + 1GB for Python/TensorFlow)

5. ##### Port 4006 available (backend will use this port)

##### Complete Installation Steps

**Step 1: Install Node.js**
1. Download from https://nodejs.org/ (LTS version recommended)
2. Run installer and complete setup
3. Verify: Open Command Prompt and type `node --version`

**Step 2: Install Python**
1. Download from https://www.python.org/downloads/ (Python 3.8 or higher)
2. **IMPORTANT:** During installation, CHECK the box "Add Python to PATH"
3. Complete installation
4. Verify: Open Command Prompt and type `python --version`

**Step 3: Install Python Libraries (TensorFlow, OpenCV, etc.)**
1. Open Command Prompt
2. Run these commands one by one:
   ```
   pip install --upgrade pip
   pip install tensorflow==2.13.0
   pip install opencv-python==4.8.0.74
   pip install numpy==1.24.3
   pip install scikit-learn==1.3.0
   pip install pillow==10.0.0
   ```
3. Wait for each to complete (may take 5-10 minutes total)

**Step 4: Run the Project**
1. Navigate to your project folder: `C:\Users\...\DeepNetSecure`
2. Double-click `run.bat`
3. Wait for "Backend running on http://localhost:4006"
4. Browser will open automatically

##### What run.bat Does

* Checks if Node.js is installed
* Installs npm dependencies (if needed)
* Builds the frontend
* Creates uploads folder
* Starts the backend server on port 4006
* Opens browser to http://localhost:4006

##### Troubleshooting

##### **Python not found error:**

* Go to Step 2 above and reinstall Python
* **Make sure to CHECK "Add Python to PATH" during installation**
* Restart Command Prompt after installation

##### **TensorFlow import failed:**

* Open Command Prompt in your project folder
* Run: `pip install tensorflow==2.13.0 --upgrade`
* If still fails, try: `pip install tensorflow==2.12.0`

##### **Node.js not found:**

* Install from https://nodejs.org/
* Restart Command Prompt

##### **Port 4006 already in use:**

* Close other applications using that port
* Restart your computer

##### **Build fails:**

* Delete `node_modules` folder
* Delete `frontend/dist` folder
* Run `run.bat` again

##### **Backend won't start - "Python not available" error:**

* Check if Python is installed: `python --version` in Command Prompt
* Check if TensorFlow is installed: `python -c "import tensorflow; print(tensorflow.__version__)"`
* If TensorFlow missing, run Step 3 again
* Check if frontend/dist folder was created
* Check if backend folder exists with all .py files

##### **ML Analysis not working ("analyze_image.py failed"):**

* Verify Python works: `python --version`
* Verify TensorFlow: `python -c "import tensorflow"`
* Reinstall TensorFlow: `pip install tensorflow==2.13.0 --upgrade`
* Check `cnn_model/embed_suitability.keras` file exists in project root

##### Verified Working On

* Windows 10/11 with Node.js v18+ and Python 3.9+
* TensorFlow 2.12 and 2.13
* pip 23.0+

