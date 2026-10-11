import type { StartupProgress, StartupStep, StartupStepId } from '@shared/ipc'

export class StartupTracker {
  private steps: StartupStep[]

  constructor(
    private readonly emit: (p: StartupProgress) => void,
    fromKeychain: boolean
  ) {
    const mk = (id: StartupStepId, label: string): StartupStep => ({ id, label, detail: '', state: 'pending' })
    this.steps = [
      mk('credentials', fromKeychain ? 'password loaded from OS keychain' : 'credentials received'),
      mk('handshake', 'ssh handshake · host key matches'),
      mk('hermes', 'hermes found'),
      mk('statedb', 'state.db opened read-only'),
      mk('collector', 'collector streaming (stdin)')
    ]
    this.push()
  }

  private set(id: StartupStepId, state: StartupStep['state'], detail: string): void {
    const s = this.steps.find((x) => x.id === id)
    if (s) {
      s.state = state
      s.detail = detail
    }
    this.push()
  }

  begin(id: StartupStepId): void {
    this.set(id, 'running', '')
  }
  done(id: StartupStepId, detail = ''): void {
    this.set(id, 'done', detail)
  }
  fail(id: StartupStepId, detail = ''): void {
    this.set(id, 'failed', detail)
  }

  private push(): void {
    this.emit({ steps: this.steps.map((s) => ({ ...s })) })
  }
}
