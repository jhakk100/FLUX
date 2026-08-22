# FLUX 개발 환경 설치

## 일반 실행

일반 사용자는 `dist/Flux.exe`만 실행하면 됩니다. Node.js 설치는 필요하지 않습니다.

## 개발·업데이트·실행 파일 재빌드

Windows x64에서는 다음 순서로 준비합니다.

```powershell
.\setup\Download-Installers.ps1
.\setup\Install-Development-Tools.ps1 -InstallNode
# Node 설치가 끝나면 새 PowerShell을 열고:
.\setup\Install-Development-Tools.ps1
```

첫 스크립트는 `setup/manifest.json`에 고정한 Node.js 24.19.0의 공식 MSI와 Linux x64 압축본을 `setup/installers/`에 내려받고, 공식 `SHASUMS256.txt`와 SHA-256을 대조합니다. Node.js 24에는 Corepack이 포함되므로 별도 pnpm 설치 파일 없이, 이 프로젝트가 고정한 pnpm 11.19.0을 사용합니다.

Linux에서는 `setup/installers/node-v24.19.0-linux-x64.tar.xz`를 원하는 위치에 풀고 `bin/`을 `PATH`에 넣은 후 다음을 실행합니다.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
```

## 버전 업데이트 규칙

Node 또는 pnpm을 업데이트할 때는 다음을 함께 변경합니다.

1. `setup/manifest.json`의 버전과 파일 이름
2. `package.json`의 `engines.node` 및 `packageManager` (필요할 때)
3. 이 문서의 명령·버전
4. `Download-Installers.ps1 -Force`를 실행해 보관함을 새 파일로 갱신
5. 테스트와 `corepack pnpm run build:win` 실행

보관된 대용량 설치 파일은 Git 추적 대상이 아닙니다. 업데이트 때 `setup/installers/`도 로컬 백업 또는 USB에 함께 복사하세요.
