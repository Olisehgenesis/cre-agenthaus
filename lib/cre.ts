const CRE_BASE_URL = process.env.CRE_API_URL ?? 'https://api.chain.link/cre/v1';
const CRE_API_KEY = process.env.CRE_API_KEY ?? '';

export type CreWorkflowRequest = {
  agentId: string;
  templateId: string;
  payload: Record<string, unknown>;
  network?: string;
};

export async function queueCreWorkflow(request: CreWorkflowRequest) {
  if (!CRE_API_KEY) {
    throw new Error('CRE_API_KEY is required to call CRE workflows.');
  }

  const body = {
    workflowId: request.templateId,
    inputs: {
      agentId: request.agentId,
      network: request.network,
      payload: request.payload,
    },
  };

  const response = await fetch(`${CRE_BASE_URL}/workflows/${request.templateId}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CRE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`CRE workflow request failed: ${response.status} ${payload}`);
  }

  return response.json();
}
