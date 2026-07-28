import './InfoLabel.css';
import { responsesAPI } from "./OpenAIRequest.js";

const responsesCreateURL =
  "https://developers.openai.com/api/reference/resources/responses/methods/create";

export default function InfoLabel({ href, apiType, responsesHref }) {
  if (apiType === responsesAPI && !href.startsWith("https://")) {
    href = responsesHref || responsesCreateURL;
  } else if (!href.startsWith('https://')) {
    href = "https://platform.openai.com/docs/api-reference/chat/create#chat-create-" + href;
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" className="info" />;
}
