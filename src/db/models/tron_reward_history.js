'use strict';
module.exports = (sequelize, DataTypes) => {
    var tron_reward_history = sequelize.define(
        'tron_reward_history',
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
            },
            reward_steem: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
            },
            reward_sbd: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
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
    return tron_reward_history;
};
