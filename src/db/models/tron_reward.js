'use strict';
module.exports = (sequelize, DataTypes) => {
    var tron_reward = sequelize.define(
        'tron_reward',
        {
            username: {
                allowNull: false,
                type: DataTypes.STRING,
            },
            tron_addr: {
                allowNull: true,
                type: DataTypes.CHAR,
            },
            pending_claim_tron_reward: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
            },
            is_new_user: {
                allowNull: false,
                type: DataTypes.BOOLEAN,
            },
            is_tron_addr_actived: {
                allowNull: false,
                type: DataTypes.BOOLEAN,
            },
            tran_addr_active_time: {
                allowNull: false,
                type: DataTypes.DATE,
            },
            tip_count: {
                allowNull: false,
                type: DataTypes.INTEGER.UNSIGNED,
            },
        },
        {
            tableName: 'tron_reward',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            timestamps: true,
            underscored: true,
        }
    );
    return tron_user;
};
