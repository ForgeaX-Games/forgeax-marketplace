export class Input {
  private keysDown = new Set<string>()
  private keysPressed = new Set<string>()

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) this.keysPressed.add(e.code)
      this.keysDown.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })
  }

  isDown(code: string): boolean { return this.keysDown.has(code) }
  isPressed(code: string): boolean { return this.keysPressed.has(code) }

  update(): void {
    this.keysPressed.clear()
  }
}
