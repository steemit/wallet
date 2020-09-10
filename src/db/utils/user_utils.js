/* eslint-disable arrow-parens */
import config from 'config';
import models from 'db/models';
import { log } from 'server/utils/loggers';

const clearPendingClaimTronReward = async username => {
    const vestsPerTrx = Number(config.get('tron_reward.vests_per_trx'));
    const user = await models.TronUser.findOne({
        where: {
            username,
        },
    });
    if (user && user.getDataValue('pending_claim_tron_reward') > 0) {
        const pendingClaimTronReward =
            user.getDataValue('pending_claim_tron_reward') / 1e5;
        // transaction
        models.sequelize.transaction().then(transaction => {
            // clear pending_claim_tron_reward
            return user
                .update(
                    {
                        pending_claim_tron_reward: 0,
                    },
                    {
                        transaction,
                    }
                )
                .then(() =>
                    models.TronReward.create(
                        {
                            username,
                            tron_addr: user.get('tron_addr'),
                            block_num: 0,
                            steem_tx_id: '',
                            reward_vests: `${pendingClaimTronReward *
                                vestsPerTrx} VESTS`,
                            reward_steem: '0 STEEM',
                            reward_sbd: '0 SBD',
                            vests_per_steem: 0,
                            reward_type: 1,
                        },
                        {
                            transaction,
                        }
                    )
                )
                .then(() => transaction.commit())
                .catch(err => {
                    transaction.rollback();
                    log('clear_pending_claim_tron_reward_error:', {
                        msg: err.message,
                    });
                });
        });
    }
};

module.exports = {
    clearPendingClaimTronReward,
};
