const NATIVE_CHANNEL = "flutterChannel"
const JAVASCRIPT_CHANNEL = "javascriptChannel"
const DEFAULT_TIMEOUT = 5000 // 5 seconds

const MESSAGE_TYPE = {
  PUBLISHER: "publisher",
  REQUEST: "request"
} as const;

const RESPONSE_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error'
} as const

type PublisherPublishParams = {
  type: typeof MESSAGE_TYPE.PUBLISHER
  eventName: string
  payload: unknown
}
type RequestPublishParams = {
  type: typeof MESSAGE_TYPE.REQUEST
  id: string
  payload: unknown
}

type PublishParams = PublisherPublishParams | RequestPublishParams

type SuccessResponse = {
  status: typeof RESPONSE_STATUS.SUCCESS
  data: unknown
}
type ErrorResponse = {
  status: typeof RESPONSE_STATUS.ERROR
  error: string
}
type RequestResponse = SuccessResponse | ErrorResponse

type SubscribeCallback = (payload: unknown) => void
type RequestCallback = (payload: RequestResponse) => void

class JSChannel {
  // Static properties
  static #instance: JSChannel | null = null

  // Instance properties
  private nativeChannel: any = window[NATIVE_CHANNEL]
  private subscribeCallbackMap: Record<string, SubscribeCallback[]> = {}
  private requestCallbackMap: Record<string, RequestCallback> = {}

  // Constructor
  constructor () {
    if (!JSChannel.#instance) {
      this.init()
      JSChannel.#instance = this
    }
    return JSChannel.#instance
  }

  // Public API methods
  publish (params: PublishParams): void {
    if (!this.nativeChannel) return
    const message = {
      type: params.type,
      ...(params.type === MESSAGE_TYPE.PUBLISHER && { eventName: params.eventName }),
      ...(params.type === MESSAGE_TYPE.REQUEST && { id: params.id }),
      payload: params.payload,
    }
    const jsonMessage = JSON.stringify(message)
    this.nativeChannel.postMessage(jsonMessage)
  }

  subscribe (eventName: string, callback: SubscribeCallback): () => void {
    if (!this.subscribeCallbackMap[eventName]) {
      this.subscribeCallbackMap[eventName] = []
    }
    this.subscribeCallbackMap[eventName].push(callback)
    return () => this.unsubscribe(eventName, callback)
  }

  unsubscribe (eventName: string, callback: SubscribeCallback): void {
    const callbacks = this.subscribeCallbackMap[eventName]
    if (!callbacks) return
    this.subscribeCallbackMap[eventName] = callbacks.filter(cb => cb !== callback)
  }

  request (payload: unknown, timeout: number = DEFAULT_TIMEOUT): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id: string = this.generateUniqueId()
      let timer: number | undefined = undefined
      this.requestCallbackMap[id] = (response: RequestResponse) => {
        clearTimeout(timer)
        delete this.requestCallbackMap[id]
        if (response.status === 'success') {
          resolve(response.data)
        } else {
          reject(response.error)
        }
      }
      timer = setTimeout(() => {
        const callback = this.requestCallbackMap[id]
        if (callback) {
          const timeoutResponse = {
            status: RESPONSE_STATUS.ERROR,
            error: "Timeout"
          }
          callback(timeoutResponse)
        }
      }, timeout)
      this.publish({ type: MESSAGE_TYPE.REQUEST, id, payload })
    })
  }

  // Public getters
  get isChannelAvailable (): boolean {
    return !!this.nativeChannel
  }

  // Private methods
  private init (): void {
    if (this.isChannelAvailable) {
      this.registerFlutterCallback()
    } else {
      console.warn(`Running in web environment - ${NATIVE_CHANNEL} is not available`)
    }
  }

  private registerFlutterCallback (): void {
    window[JAVASCRIPT_CHANNEL] = ({ type, eventName, id, payload }) => {
      if (type === MESSAGE_TYPE.PUBLISHER) {
        const callbacks = this.subscribeCallbackMap[eventName]
        if (callbacks && callbacks.length) {
          callbacks.forEach(cb => cb(payload))
        }
      } else if (type === MESSAGE_TYPE.REQUEST) {
        const callback = this.requestCallbackMap[id]
        if (callback) {
          callback(payload)
        }
      }
    }
  }

  private generateUniqueId (): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

const jsChannel = new JSChannel()
export default jsChannel