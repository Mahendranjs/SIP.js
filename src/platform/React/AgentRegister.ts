import { EventEmitter } from "events";
import { UserAgent } from "../../api/user-agent.js";
import { Registerer } from "../../api/registerer.js";
import { Session } from "../../api/session.js";
import { Invitation } from "../../api/invitation.js";
import { Message } from "../../api/message.js";
import { Inviter } from "../../api/inviter.js";
import { SessionState } from "../../api/session-state.js";


export class AgentRegister {
  private userAgent: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private Session: Session | null = null;
  private originalVideoTrack: MediaStreamTrack | null = null;
  private ScreenSharedTrack: MediaStream | null = null;
  /**
   * Constructs a new instance of the `AgentRegister` class.
   * @param SOCKET_URL - Socket Base URL
   * @param UserName - User Agent Authorization Name.
   * @param Password - User Agent Authorization Password.
   * @param DisplayName - User Agent Display Name.
   */

  public constructor(
    SOCKET_URL: string,
    UserName: string,
    Password: string,
    DisplayName: string
  ) {
    this.userAgent = new UserAgent({
      uri: UserAgent.makeURI(`sip:${UserName}@cfss.ccxai.in`),
      transportOptions: { server: SOCKET_URL },
      authorizationUsername: UserName,
      authorizationPassword: Password,
      displayName: DisplayName ?? "Unknown",
      logLevel: "debug",
    });

    this.registerer = new Registerer(this.userAgent);

    // Start SIP agent and register
    this.initialize();
  }

  private async initialize() {
    if (this.userAgent) {
      try {
        await this.userAgent.start();
        await this.registerer?.register();
        this.userAgent.delegate = {
          onInvite: (invitation: Invitation) => {
            console.log("Incoming Call:", invitation);

            // Emit event for incoming invitation
            this.Session = invitation;
            this.emit("invitationReceived", invitation);
          },
          onMessage: async (message: Message) => {
            if (!message.request.body) return;
            const data = JSON.parse(message.request.body);
            console.log(data);
            if (data?.type === "screenshare") {
              console.log(data.value);
              if (!data.value) {
                await this.StopScreenShare();
              }
            }
          },
        };

        console.log("SIP Registered Automatically in Constructor");
      } catch (error) {
        console.error("Error during SIP initialization:", error);
      }
    }
  }

  public async stop() {
    if (this.registerer) {
      await this.registerer.unregister();
    }
    if (this.userAgent) {
      await this.userAgent.stop();
    }
    console.log("SIP Unregistered");
  }

  public async makeCall(
    target: string,
    toDisplayName: string,
    remoteVideoRef: HTMLVideoElement | null
  ) {
    if (!this.userAgent) {
      console.error("UserAgent is not initialized.");
      return;
    }

    if (!target) {
      console.error("Remote Agent is Not Valid");
    }

    try {
      const targetURI: any = UserAgent.makeURI(`sip:${target}@cfss.ccxai.in`);
      const inviter = new Inviter(this.userAgent, targetURI, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: true },
        },
        params: {
          fromDisplayName: this.userAgent.configuration.displayName,
          toDisplayName: toDisplayName,
        },
      });
      this.handleIncomingCall(inviter, remoteVideoRef);
      await inviter.invite();
      this.Session = inviter;
    } catch (error) {
      console.error("Call failed:", error);
    }
  }

  public get getUserAgent(): UserAgent | null {
    return this.userAgent;
  }

  // Accept an incoming invitation
  public async acceptInvitation(
    invitation: Invitation,
    remoteVideoRef: HTMLVideoElement | null
  ) {
    try {
      console.log("Accepting incoming call...");
      invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: {
            audio: true,
            video: true,
          },
        },
      });

      // Handle the call once it's accepted
      this.handleIncomingCall(invitation, remoteVideoRef);
    } catch (error) {
      console.error("Error accepting invitation:", error);
    }
  }

  private async handleIncomingCall(
    invitation: Invitation,
    remoteVideoRef: HTMLVideoElement | null
  ) {
    invitation.stateChange.addListener(async (state) => {
      switch (state) {
        case SessionState.Establishing:
          console.log("Call is establishing...");
          break;

        case SessionState.Established:
          console.log("Call established.");

          const remoteStream = new MediaStream();
          invitation.sessionDescriptionHandler.peerConnection
            .getReceivers()
            .forEach((receiver) => {
              if (receiver.track) {
                remoteStream.addTrack(receiver.track);
              }
            });

          // Assuming remoteVideoRef is passed to display the remote stream
          console.log(remoteStream);
          remoteVideoRef!.srcObject = remoteStream;

          break;

        case SessionState.Terminated:
          console.log("Call ended.");
          // Cleanup after the call ends

          remoteVideoRef!.srcObject = null;
          break;
      }
    });
  }

  public async StartScreenShare() {
    if (!this.Session) return;

    try {
      console.log(this.Session);
      const peerConnection =
        this.Session.sessionDescriptionHandler.peerConnection;

      // Fetch the existing video track (default camera)
      const sender = peerConnection
        .getSenders()
        .find((s) => s.track?.kind === "video");
      if (sender) {
        this.originalVideoTrack = sender.track; // Store original track
      }

      // Get screen-sharing stream
      const option = { video: { cursor: "always" } };
      const streams = await navigator.mediaDevices.getDisplayMedia(option);
      const videoTrack = streams.getVideoTracks()[0];
      this.ScreenSharedTrack = streams;
      if (sender) {
        await sender.replaceTrack(videoTrack);
        console.log("Replaced track with screen share", sender);
      } else {
        await peerConnection.addTrack(videoTrack, streams);
      }

      this.Session.message({
        requestOptions: {
          body: {
            content: JSON.stringify({
              type: "screenshare",
              value: false,
            }),
            contentDisposition: "",
            contentType: "",
          },
        },
      });

      // Handle screen share stop event
      videoTrack.onended = () => {
        this.StopScreenShare();
      };
    } catch (e) {
      console.error("Screen sharing error:", e);
    }
  }

  public async StopScreenShare() {
    console.log(this.userAgent, this.Session, this.originalVideoTrack);
    if (!this.userAgent || !this.Session || !this.originalVideoTrack) return;

    try {
      console.log("Stopping screen share...");

      if (this.ScreenSharedTrack) {
        this.ScreenSharedTrack.getTracks().forEach((track) => track.stop());
      }
      const peerConnection =
        this.Session.sessionDescriptionHandler.peerConnection;
      const sender = peerConnection
        .getSenders()
        .find((s) => s.track?.kind === "video");

      if (sender) {
        await sender.replaceTrack(this.originalVideoTrack);
        console.log("Replaced screen share with original camera video");
      }
    } catch (error) {
      console.error("Error stopping screen share:", error);
    }
  }

  public async HangUp() {
    if (!this.userAgent && !this.Session) return;

    try {
      this.userAgent?.stop();
      this.Session?.bye();
    } catch (error) {}
  }
}
