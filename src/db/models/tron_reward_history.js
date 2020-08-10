module.exports = (sequelize, DataTypes) => {
    const tronRewardHistory = sequelize.define(
        'TronRewardHistory',
        {
            username: {
                allowNull: false,
                type: DataTypes.STRING,
            },
            tron_addr: {
                allowNull: true,
                type: DataTypes.CHAR,
            },
            block_num: {
                allowNull: false,
                type: DataTypes.INTEGER.UNSIGNED,
            },
            steem_tx_id: {
                allowNull: false,
                type: DataTypes.CHAR,
            },
            tron_tx_id: {
                allowNull: true,
                type: DataTypes.CHAR,
            },
            reward_vests: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
                get() {
                    return `${this.getDataValue('reward_vests') / 1e6} VESTS`;
                },
                set(v) {
                    const tmp = v.split(' ');
                    if (tmp[1] !== 'VESTS') throw 'error reward_vests';
                    this.setDataValue(
                        'reward_vests',
                        parseInt(tmp[0] * 1e6, 10)
                    );
                },
            },
            reward_steem: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
                get() {
                    return `${this.getDataValue('reward_steem') / 1e3} STEEM`;
                },
                set(v) {
                    const tmp = v.split(' ');
                    if (tmp[1] !== 'STEEM') throw 'error reward_steem';
                    this.setDataValue(
                        'reward_steem',
                        parseInt(tmp[0] * 1e3, 10)
                    );
                },
            },
            reward_sbd: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
                get() {
                    return `${this.getDataValue('reward_sbd') / 1e3} SBD`;
                },
                set(v) {
                    const tmp = v.split(' ');
                    if (tmp[1] !== 'SBD') throw 'error reward_sbd';
                    this.setDataValue('reward_sbd', parseInt(tmp[0] * 1e3, 10));
                },
            },
            vests_per_steem: {
                allowNull: false,
                type: DataTypes.FLOAT,
            },
        },
        {
            tableName: 'tron_reward_history',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            timestamps: true,
            underscored: true,
        }
    );
    return tronRewardHistory;
};
