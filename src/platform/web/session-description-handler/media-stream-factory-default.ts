import { UserAgentCore } from "../../../core/index.js";
import { MediaStreamFactory } from "./media-stream-factory.js";
import { SessionDescriptionHandler } from "./session-description-handler.js";

/**
 * Function which returns a MediaStreamFactory.
 * @public
 */
export function defaultMediaStreamFactory(
  UserAgentCore: any
): MediaStreamFactory {
  return (
    constraints: MediaStreamConstraints,
    sessionDescriptionHandlers: SessionDescriptionHandler
  ): Promise<MediaStream> => {
    console.log(constraints, UserAgentCore.UserAgentCore);

    if (!constraints.audio && !constraints.video) {
      return Promise.resolve(new MediaStream());
    }

    if (navigator.mediaDevices === undefined) {
      return Promise.reject(
        new Error("Media devices not available in insecure contexts.")
      );
    }

    if (constraints.video) {
      return navigator.mediaDevices.getUserMedia(constraints).catch((error) => {
        if (
          error.name === "NotAllowedError" ||
          error.name === "NotFoundError"
        ) {
          console.log(
            "Video permission denied or no video device found. Using canvas."
          );

          const DisplayName =
            UserAgentCore.UserAgentCore?.toDisplayName
              ?.charAt(0)
              .toUpperCase() || "NA";

          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");

          function drawPlaceholder() {
            if (!ctx) return;
            ctx.fillStyle = "#1f2937"; // Dark background
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw avatar circle
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, 60, 0, Math.PI * 2);
            ctx.fillStyle = "#4b5563";
            ctx.fill();

            // Draw initials
            ctx.font = "48px system-ui";
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(DisplayName, canvas.width / 2, canvas.height / 2);
          }

          // Initial draw
          drawPlaceholder();

          // Update canvas every second
          setInterval(drawPlaceholder, 1000 / 30); // 30 FPS

          const videoStream = canvas.captureStream(30); // Ensure continuous updates
          const videoTrack = videoStream.getVideoTracks()[0];

          if (constraints.audio) {
            return navigator.mediaDevices
              .getUserMedia({ audio: constraints.audio })
              .then((audioStream) => {
                const mediaStream = new MediaStream();
                mediaStream.addTrack(videoTrack);
                audioStream
                  .getAudioTracks()
                  .forEach((track) => mediaStream.addTrack(track));
                return mediaStream;
              })
              .catch((audioError) => {
                console.warn("Audio permission denied:", audioError);
                return new MediaStream([videoTrack]); // Only return video if audio fails
              });
          }

          return new MediaStream([videoTrack]); // Return only the canvas video track
        }

        return Promise.reject(error);
      });
    }

    if (constraints.audio && !constraints.video) {
      return navigator.mediaDevices
        .getUserMedia({ audio: constraints.audio })
        .then((stream) => new MediaStream(stream.getAudioTracks()));
    }

    return navigator.mediaDevices.getUserMedia(constraints);
  };
}
