# Portfolio AI Job Scanner

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this folder.
5. Open LinkedIn, Naukri, Hirist, Indeed, or Adzuna and log in normally.
6. Open the extension, enter the portfolio API URL and your `authToken` once.
7. Click **Scan current job-board page**.
8. Open an application page and click **Start assisted application**. It fills supported fields and highlights the final submit control for your review.
9. Complete any missing screening questions and submit the application on the job board or employer ATS.
10. Open the extension and click **I submitted this application**. The job will appear as `submitted` in your portfolio dashboard.

The extension imports jobs through `POST /api/jobs/import`. The backend then scores the imported jobs with the configured AI provider.

For LinkedIn, Naukri, Hirist, Indeed, and Adzuna pages, the scanner extracts visible job cards and sends them to the portfolio API. For supported Easy Apply pages, the assistant can fill known fields, prompt for missing required data, and submit after your confirmation. It does not guess screening answers, upload files without your selection, or bypass CAPTCHA/MFA.

The status button records the application after you submit it. The extension cannot reliably detect a successful submission on another site because job boards and employer ATS pages isolate their form state.

Autofill only writes into empty matching fields. It does not click Submit, answer unknown screening questions, upload a resume, or bypass CAPTCHA/MFA.

## Optional local Playwright runner

For a user-controlled browser session, use the local runner. It launches a persistent browser profile, so you can log in manually once and reuse that session on later runs. The hosted setup does not require the backend or frontend to run locally:

```powershell
cd playwright-runner
npm install
$env:PORTFOLIO_API_URL="https://my-portfolio-backend-0ezn.onrender.com"
$env:PORTFOLIO_TOKEN="your-token" # Optional: omit this to log in through the browser
$env:PORTFOLIO_LOGIN_URL="https://my-portfolio-frontend-chi-five.vercel.app/login"
$env:JOB_APPLICATION_URL="https://the-job-board.example/application"
npm run apply
```

If `PORTFOLIO_TOKEN` is omitted or left as `your-token`, the runner opens `PORTFOLIO_LOGIN_URL`, waits for you to log in, and reads the signed-in browser profile's `authToken`. The runner then fills recognized profile fields, asks for required values it cannot map, and requires typing `SUBMIT` before clicking a final submit button. CAPTCHA, MFA, file uploads, unsupported widgets, and site-specific flows remain manual.

The runner reads `authToken` from the Vercel login session when `PORTFOLIO_TOKEN` is omitted or left as `your-token`. In the extension, click **Use hosted portfolio token** while the Vercel portfolio tab is active; if you are not on that tab, the extension opens it for login. After signing in, open the extension on the Vercel tab and click the button again. It stores that hosted JWT for the Render API. Do not mix a localhost login token with the Render API URL.

Local development remains supported by setting `PORTFOLIO_API_URL=http://localhost:5000` and `PORTFOLIO_LOGIN_URL=http://localhost:3000/login` together.

To control an already-open Chromium session instead, start that browser with remote debugging and set `PLAYWRIGHT_CDP_URL` (for example `http://127.0.0.1:9222`). The runner will connect to the existing session and will not close that browser when it exits.
