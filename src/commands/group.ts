import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '../config/prisma';
import { resolveGuildId } from '../utils/guildResolver';
import { logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('group')
  .setDescription('Hệ thống Nhóm Học Tập (Study Groups) gắn kết và thi đua cùng bạn bè')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Tạo một nhóm học tập mới trong Server')
      .addStringOption((opt) =>
        opt.setName('ten_nhom').setDescription('Tên nhóm học tập (tối đa 50 ký tự)').setRequired(true).setMaxLength(50)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('invite')
      .setDescription('Mời một thành viên trong server tham gia nhóm (Chỉ dành cho Trưởng nhóm)')
      .addUserOption((opt) =>
        opt.setName('nguoi_dung').setDescription('Thành viên bạn muốn mời vào nhóm').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('leave').setDescription('Rời khỏi nhóm học tập hiện tại của bạn')
  )
  .addSubcommand((sub) =>
    sub
      .setName('kick')
      .setDescription('Mời một thành viên ra khỏi nhóm (Chỉ dành cho Trưởng nhóm)')
      .addUserOption((opt) =>
        opt.setName('nguoi_dung').setDescription('Thành viên bạn muốn mời ra khỏi nhóm').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('stats').setDescription('Xem thống kê học tập tổng hợp của cả nhóm & Vinh danh MVP tuần')
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Xem danh sách tất cả các nhóm học tập trong Server này')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Đảm bảo lệnh được chạy trong Guild
  if (!interaction.guildId) {
    await interaction.reply({
      content: '❌ Lệnh `/group` chỉ có thể sử dụng bên trong một Server Discord.',
      ephemeral: true,
    });
    return;
  }

  const discordUserId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  // Đảm bảo User có trong CSDL
  const user = await prisma.user.upsert({
    where: { discordUserId },
    create: { discordUserId, username: interaction.user.username },
    update: { username: interaction.user.username },
  });

  // Đảm bảo Guild tồn tại trong CSDL (upsert an toàn)
  const internalGuild = await prisma.guild.upsert({
    where: { discordGuildId: interaction.guildId },
    create: { discordGuildId: interaction.guildId },
    update: {},
  });

  // 1. TẠO NHÓM MỚI
  if (subcommand === 'create') {
    const groupName = interaction.options.getString('ten_nhom', true).trim();

    try {
      // Kiểm tra xem User đã ở trong nhóm nào tại Guild này chưa
      const existingMembership = await prisma.studyGroupMember.findFirst({
        where: {
          userId: user.id,
          group: { guildId: internalGuild.id },
        },
        include: { group: true },
      });

      if (existingMembership) {
        await interaction.reply({
          content: `❌ Bạn hiện đã là thành viên của nhóm **"${existingMembership.group.name}"**. Mỗi người chỉ được tham gia 1 nhóm trong server.`,
          ephemeral: true,
        });
        return;
      }

      // Kiểm tra tên nhóm đã tồn tại trong Guild chưa
      const existingName = await prisma.studyGroup.findUnique({
        where: {
          guildId_name: {
            guildId: internalGuild.id,
            name: groupName,
          },
        },
      });

      if (existingName) {
        await interaction.reply({
          content: `❌ Nhóm **"${groupName}"** đã tồn tại trong server. Vui lòng chọn một tên khác!`,
          ephemeral: true,
        });
        return;
      }

      // Tạo nhóm và gán người tạo làm owner + member
      const newGroup = await prisma.$transaction(async (tx) => {
        const group = await tx.studyGroup.create({
          data: {
            name: groupName,
            guildId: internalGuild.id,
            ownerId: user.id,
            maxMembers: 10,
          },
        });

        await tx.studyGroupMember.create({
          data: {
            groupId: group.id,
            userId: user.id,
          },
        });

        return group;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🎉 Khởi Tạo Nhóm Học Tập Thành Công!`)
        .setDescription(
          `Nhóm **"${newGroup.name}"** đã chính thức được thành lập!\n\n` +
            `👑 **Trưởng nhóm:** <@${interaction.user.id}>\n` +
            `👥 **Sức chứa:** 1/10 thành viên\n\n` +
            `👉 Dùng lệnh \`/group invite nguoi_dung: @bạn_bè\` để cùng nhau học tập nhé!`
        )
        .setColor(0x57f287)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    } catch (error) {
      logger.error('Error in /group create', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi tạo nhóm học tập.', ephemeral: true });
      return;
    }
  }

  // 2. MỜI THÀNH VIÊN VÀO NHÓM
  if (subcommand === 'invite') {
    const targetDiscordUser = interaction.options.getUser('nguoi_dung', true);

    if (targetDiscordUser.bot) {
      await interaction.reply({ content: '❌ Bạn không thể mời Bot vào nhóm học tập.', ephemeral: true });
      return;
    }

    if (targetDiscordUser.id === interaction.user.id) {
      await interaction.reply({ content: '❌ Bạn đã ở trong nhóm rồi.', ephemeral: true });
      return;
    }

    try {
      // Tìm nhóm do user làm owner trong Guild này
      const ownedGroup = await prisma.studyGroup.findFirst({
        where: {
          guildId: internalGuild.id,
          ownerId: user.id,
        },
        include: {
          members: true,
        },
      });

      if (!ownedGroup) {
        await interaction.reply({
          content: '❌ Bạn không phải là Trưởng nhóm của nhóm học tập nào trong Server này.',
          ephemeral: true,
        });
        return;
      }

      if (ownedGroup.members.length >= ownedGroup.maxMembers) {
        await interaction.reply({
          content: `⚠️ Nhóm **"${ownedGroup.name}"** đã đạt số lượng tối đa (${ownedGroup.maxMembers} thành viên).`,
          ephemeral: true,
        });
        return;
      }

      const targetUser = await prisma.user.upsert({
        where: { discordUserId: targetDiscordUser.id },
        create: { discordUserId: targetDiscordUser.id, username: targetDiscordUser.username },
        update: { username: targetDiscordUser.username },
      });

      // Kiểm tra người được mời đã ở nhóm nào trong Server chưa
      const targetExisting = await prisma.studyGroupMember.findFirst({
        where: {
          userId: targetUser.id,
          group: { guildId: internalGuild.id },
        },
        include: { group: true },
      });

      if (targetExisting) {
        await interaction.reply({
          content: `❌ <@${targetDiscordUser.id}> hiện đã tham gia nhóm **"${targetExisting.group.name}"**.`,
          ephemeral: true,
        });
        return;
      }

      await prisma.studyGroupMember.create({
        data: {
          groupId: ownedGroup.id,
          userId: targetUser.id,
        },
      });

      const embed = new EmbedBuilder()
        .setTitle('🤝 Thành Viên Mới Đã Gia Nhập Nhóm!')
        .setDescription(
          `Chào mừng <@${targetDiscordUser.id}> đã trở thành thành viên thứ **${ownedGroup.members.length + 1}/${ownedGroup.maxMembers}** của nhóm **"${ownedGroup.name}"**!\n\n` +
            `🔥 Hãy cùng nhau duy trì chuỗi Streak và hoàn thành các bài học nhé!`
        )
        .setColor(0x5865f2);

      await interaction.reply({ embeds: [embed] });
      return;
    } catch (error) {
      logger.error('Error in /group invite', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi xảy ra khi mời thành viên.', ephemeral: true });
      return;
    }
  }

  // 3. RỜI KHỎI NHÓM
  if (subcommand === 'leave') {
    try {
      const membership = await prisma.studyGroupMember.findFirst({
        where: {
          userId: user.id,
          group: { guildId: internalGuild.id },
        },
        include: {
          group: {
            include: { members: { orderBy: { joinedAt: 'asc' } } },
          },
        },
      });

      if (!membership) {
        await interaction.reply({
          content: '❌ Bạn hiện không tham gia nhóm học tập nào trong Server này.',
          ephemeral: true,
        });
        return;
      }

      const group = membership.group;
      const isOwner = group.ownerId === user.id;

      if (isOwner) {
        // Nếu owner rời: nếu còn thành viên khác thì chuyển giao quyền owner cho người cũ nhất
        const remainingMembers = group.members.filter((m) => m.userId !== user.id);

        if (remainingMembers.length > 0) {
          const nextOwner = remainingMembers[0];
          await prisma.$transaction([
            prisma.studyGroupMember.delete({ where: { id: membership.id } }),
            prisma.studyGroup.update({
              where: { id: group.id },
              data: { ownerId: nextOwner.userId },
            }),
          ]);

          await interaction.reply({
            content: `👋 Bạn đã rời nhóm **"${group.name}"**. Quyền Trưởng nhóm đã được tự động chuyển giao cho thành viên kỳ cựu tiếp theo!`,
            ephemeral: true,
          });
        } else {
          // Nhóm không còn ai -> Xóa nhóm
          await prisma.studyGroup.delete({ where: { id: group.id } });
          await interaction.reply({
            content: `👋 Bạn đã rời nhóm. Do không còn thành viên nào, nhóm **"${group.name}"** đã được giải tán.`,
            ephemeral: true,
          });
        }
      } else {
        await prisma.studyGroupMember.delete({ where: { id: membership.id } });
        await interaction.reply({
          content: `👋 Bạn đã rời khỏi nhóm **"${group.name}"** thành công.`,
          ephemeral: true,
        });
      }
      return;
    } catch (error) {
      logger.error('Error in /group leave', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi rời nhóm.', ephemeral: true });
      return;
    }
  }

  // 4. KICK THÀNH VIÊN
  if (subcommand === 'kick') {
    const targetDiscordUser = interaction.options.getUser('nguoi_dung', true);

    if (targetDiscordUser.id === interaction.user.id) {
      await interaction.reply({
        content: '❌ Bạn không thể tự kick chính mình. Dùng `/group leave` nếu muốn rời nhóm.',
        ephemeral: true,
      });
      return;
    }

    try {
      const ownedGroup = await prisma.studyGroup.findFirst({
        where: {
          guildId: internalGuild.id,
          ownerId: user.id,
        },
      });

      if (!ownedGroup) {
        await interaction.reply({
          content: '❌ Bạn không có quyền kick vì bạn không phải là Trưởng nhóm.',
          ephemeral: true,
        });
        return;
      }

      const targetMember = await prisma.studyGroupMember.findFirst({
        where: {
          groupId: ownedGroup.id,
          user: { discordUserId: targetDiscordUser.id },
        },
      });

      if (!targetMember) {
        await interaction.reply({
          content: `❌ <@${targetDiscordUser.id}> không nằm trong nhóm **"${ownedGroup.name}"** của bạn.`,
          ephemeral: true,
        });
        return;
      }

      await prisma.studyGroupMember.delete({
        where: { id: targetMember.id },
      });

      await interaction.reply({
        content: `👢 Đã mời <@${targetDiscordUser.id}> ra khỏi nhóm **"${ownedGroup.name}"**.`,
      });
      return;
    } catch (error) {
      logger.error('Error in /group kick', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi xảy ra khi kick thành viên.', ephemeral: true });
      return;
    }
  }

  // 5. XEM THỐNG KÊ NHÓM & MVP
  if (subcommand === 'stats') {
    await interaction.deferReply();

    try {
      const membership = await prisma.studyGroupMember.findFirst({
        where: {
          userId: user.id,
          group: { guildId: internalGuild.id },
        },
        include: {
          group: {
            include: {
              owner: true,
              members: {
                include: {
                  user: {
                    include: {
                      quizSessions: {
                        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
                      },
                      pomodoroSessions: {
                        where: { startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
                      },
                      flashcardDecks: {
                        include: { _count: { select: { cards: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!membership) {
        await interaction.editReply({
          content: '❌ Bạn chưa tham gia nhóm học tập nào. Hãy dùng `/group create` để tạo nhóm hoặc nhờ bạn bè mời vào nhóm nhé!',
        });
        return;
      }

      const group = membership.group;
      const members = group.members;

      let totalStreak = 0;
      let totalQuizzes = 0;
      let totalPomoMinutes = 0;
      let totalCards = 0;

      let mvpUser: { username: string; score: number } = { username: 'Chưa có', score: -1 };

      const memberRows = members.map((m) => {
        const u = m.user;
        const quizCount = u.quizSessions.length;
        const pomoMins = u.pomodoroSessions.reduce((sum, p) => sum + p.workMinutes, 0);
        const pomoHours = (pomoMins / 60).toFixed(1);
        const cardsCount = u.flashcardDecks.reduce((sum, d) => sum + d._count.cards, 0);

        totalStreak += u.streakCount;
        totalQuizzes += quizCount;
        totalPomoMinutes += pomoMins;
        totalCards += cardsCount;

        // Điểm hoạt động MVP = (Streak * 2) + (Quiz * 3) + (PomodoroHours * 2)
        const activityScore = (u.streakCount * 2) + (quizCount * 3) + (Number(pomoHours) * 2);
        if (activityScore > mvpUser.score) {
          mvpUser = { username: u.username, score: activityScore };
        }

        return `• **@${u.username}** ${u.id === group.ownerId ? '👑' : ''}\n  └ 🔥 Streak: **${u.streakCount}** | 📝 Quiz: **${quizCount}** | 🍅 Pomo: **${pomoHours}h** | 🗂️ Thẻ: **${cardsCount}**`;
      });

      const avgStreak = (totalStreak / members.length).toFixed(1);
      const totalPomoHours = (totalPomoMinutes / 60).toFixed(1);

      const embed = new EmbedBuilder()
        .setTitle(`📊 Bảng Thống Kê Học Tập: "${group.name}"`)
        .setDescription(
          `👑 **Trưởng nhóm:** @${group.owner.username} • 👥 **Thành viên:** ${members.length}/${group.maxMembers}\n\n` +
            `🏆 **MVP Năng Nổ Tuần Này:** 👑 **@${mvpUser.username}** *(Điểm tích cực: ${mvpUser.score})*\n\n` +
            `📈 **CHỈ SỐ TOÀN NHÓM (7 NGÀY QUA):**\n` +
            `🔥 **Streak trung bình:** \`${avgStreak} ngày\`\n` +
            `📝 **Tổng bài Quiz đã làm:** \`${totalQuizzes} bài\`\n` +
            `🍅 **Tổng giờ Pomodoro:** \`${totalPomoHours} giờ\`\n` +
            `🗂️ **Tổng kho thẻ Flashcard:** \`${totalCards} thẻ\`\n\n` +
            `👥 **BẢNG THÀNH TÍCH THÀNH VIÊN:**\n${memberRows.join('\n')}`
        )
        .setColor(0x57f287)
        .setFooter({ text: 'Cùng nhau học tập để duy trì thành tích nhóm tốt nhất!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    } catch (error) {
      logger.error('Error in /group stats', { userId: user.id, error: String(error) });
      await interaction.editReply({ content: '❌ Có lỗi khi tổng hợp thống kê nhóm.' });
      return;
    }
  }

  // 6. DANH SÁCH CÁC NHÓM TRONG SERVER
  if (subcommand === 'list') {
    try {
      const groups = await prisma.studyGroup.findMany({
        where: { guildId: internalGuild.id },
        include: {
          owner: true,
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (groups.length === 0) {
        await interaction.reply({
          content: '📭 Hiện chưa có nhóm học tập nào trong Server này. Hãy dùng `/group create` để tạo nhóm đầu tiên!',
          ephemeral: true,
        });
        return;
      }

      const groupFields = groups.map((g) => ({
        name: `📁 ${g.name}`,
        value: `• 👑 Trưởng nhóm: **@${g.owner.username}**\n• 👥 Số thành viên: **${g._count.members}/${g.maxMembers}**`,
        inline: true,
      }));

      const embed = new EmbedBuilder()
        .setTitle(`📚 Danh Sách Nhóm Học Tập — ${interaction.guild?.name || 'Server'}`)
        .setDescription(`Tổng cộng: **${groups.length} nhóm học tập** đang hoạt động sôi nổi.`)
        .setColor(0x5865f2)
        .addFields(groupFields)
        .setFooter({ text: 'Dùng /group stats để xem thành tích chi tiết nhóm của bạn' });

      await interaction.reply({ embeds: [embed] });
      return;
    } catch (error) {
      logger.error('Error in /group list', { userId: user.id, error: String(error) });
      await interaction.reply({ content: '❌ Có lỗi khi tải danh sách nhóm.', ephemeral: true });
      return;
    }
  }
}
