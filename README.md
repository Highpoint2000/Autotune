# Autotune
This plugin for the FM DX web server automatically optimizes reception by scanning nearby frequencies to find the perfect balance between the strongest signal and the least interference.

<img width="1077" height="332" alt="Screenshot 2026-04-22 080354" src="https://github.com/user-attachments/assets/e6242dc2-b73f-4a16-ba22-5f79ba292711" />



## Version 1.0a

- The auto-tune process is now always started from the base frequency to avoid exceeding the 50 kHz upper and lower limits.

## Installation notes:

1. [Download](https://github.com/Highpoint2000/Autotune/releases) the last repository as a zip
2. Unpack all files from the plugins folder to ..fm-dx-webserver-main\plugins\ 
3. Stop or close the fm-dx-webserver
4. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
5. Activate the autotune plugin in the settings
6. Reload the browser

## How to use:     
                                         
- Locate the Button: You will find the Auto Tune button in the bottom-right corner of the Frequency box
- One-Click Optimization: Simply click the button once

  The Process: 
  - The plugin will scan small frequency steps around your current position (10 kHz steps in FM, 1 kHz in AM)
  - It calculates a "Score" for each step, weighing the signal strength against interference (CCI and ACI)
  - Once the scan is complete, it automatically switches to the frequency with the highest score

- Setting the header variable "var ENABLE_DEBUG_LOG = true" displays detailed information about the evaluation and decision-making process in the browser console (F12)

## Contact

If you have any questions, would like to report problems, or have suggestions for improvement, please feel free to contact me! You can reach me by email at highpoint2000@googlemail.com. I look forward to hearing from you!

<a href="https://www.buymeacoffee.com/Highpoint" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

<details>
<summary>History</summary>

### Version 1.0

- Intelligent signal optimization: By scanning adjacent frequencies, the optimal frequency peak is found by balancing maximum signal strength and interference losses (CCI/ACI).
- Adaptive scan logic: Automatically adjusts the tuning steps to the frequency band (1 kHz steps for AM, 10 kHz steps for FM).
- Enhanced button control: "Frequency increase/decrease" buttons are used in FM to ensure precise 100 kHz steps, independent of server-side rounding logic.
- Compatible with Enhanced Tuning Plugin

