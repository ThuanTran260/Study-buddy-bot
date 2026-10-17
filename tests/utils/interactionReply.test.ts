import { sendEphemeralAfterDefer } from '../../src/utils/interactionReply';

function makeInteraction(deleteReplyImpl: jest.Mock): any {
  return {
    deleteReply: deleteReplyImpl,
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

const order = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0] ?? Infinity;

describe('sendEphemeralAfterDefer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the public placeholder then sends an ephemeral follow-up', async () => {
    const interaction = makeInteraction(jest.fn().mockResolvedValue(undefined));

    await sendEphemeralAfterDefer(interaction, 'msg');

    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'msg',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    expect(order(interaction.deleteReply)).toBeLessThan(order(interaction.followUp));
  });

  it('still sends the follow-up when deleteReply rejects', async () => {
    const interaction = makeInteraction(jest.fn().mockRejectedValue(new Error('Unknown Message')));

    await expect(sendEphemeralAfterDefer(interaction, 'msg')).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'msg',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  });
});
