'use strict';
module.exports = (sequelize, DataTypes) => {
    var tron_user = sequelize.define(
        'tron_user',
        {
            username: {
                type: Sequelize.STRING(16),
            },
            tron_addr: {
                allowNull: true,
                type: Sequelize.CHAR(34),
            },
            pending_claim_tron_reward: {
                type: Sequelize.BIGINT.UNSIGNED,
            },
            is_new_user: {
                type: Sequelize.BOOLEAN,
            },
            is_tron_addr_actived: {
                type: Sequelize.BOOLEAN,
            },
            tran_addr_active_time: {
                type: Sequelize.DATE,
            },
            tip_count: {
                type: Sequelize.INTEGER.UNSIGNED,
            },
        },
        {
            tableName: 'tron_user',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            timestamps: true,
            underscored: true,
        }
    );
    return tron_user;
};
