import React, { Component } from 'react';
import PropTypes from 'prop-types';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { connect } from 'react-redux';

const CreateCommunity = ({ accountName }) => {
    return (
        <div className="row">
            <div className="column large-6 small-12">
                <div>CREATE A COMMUNITY</div>
                <label for="community_title">Title</label>
                <input
                    id="community_title"
                    name="community_title"
                    minLength="4"
                    maxLength="30"
                    required
                />
                <label for="community_description">Description</label>
                <input
                    id="community_description"
                    name="community_description"
                    minLength="10"
                    maxLength="140"
                    required
                />
                <label id="is_nsfw" for="is_nsfw">
                    Is NSFW.
                </label>
                <input type="checkbox" name="is_nsfw" />
            </div>
        </div>
    );
};

export default connect(
    (state, ownProps) => {
        const { account } = ownProps;
        const accountName = account.get('name');
        const current = state.user.get('current');
        const username = current && current.get('username');
        const isMyAccount = username === accountName;
        return { ...ownProps, isMyAccount, accountName };
    },
    dispatch => ({})
)(CreateCommunity);
